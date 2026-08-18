use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use anchor_lang::InstructionData;
use anchor_lang::ToAccountMetas;
use anyhow::anyhow;
use borsh::BorshDeserialize;
use bs58::encode;
use clap::{Parser, Subcommand};
use itertools::Itertools;
use proof_of_work_faucet::Difficulty;
use solana_account_decoder::UiAccountEncoding;
use solana_cli_config::{Config, ConfigInput, CONFIG_FILE};
use solana_client::client_error::ClientErrorKind;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_config::RpcAccountInfoConfig;
use solana_client::rpc_config::RpcProgramAccountsConfig;
use solana_client::rpc_filter::RpcFilterType;
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::instruction::Instruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::read_keypair_file;
use solana_sdk::signer::keypair::Keypair;
use solana_sdk::signer::Signer;

pub fn get_network(network_str: &str) -> &str {
    match network_str {
        "devnet" | "dev" | "d" => "https://api.devnet.solana.com",
        "mainnet" | "main" | "m" | "mainnet-beta" => "https://api.mainnet-beta.solana.com",
        "localnet" | "localhost" | "l" | "local" => "http://localhost:8899",
        _ => network_str,
    }
}

pub fn get_payer_keypair_from_path(path: &str) -> anyhow::Result<Keypair> {
    read_keypair_file(&*shellexpand::tilde(path)).map_err(|e| anyhow!(e.to_string()))
}

#[derive(Parser, Debug)]
#[clap(version, about)]
struct Arguments {
    #[clap(subcommand)]
    subcommand: SubCommand,
    /// Optionally include your keypair path. Defaults to your Solana CLI config file.
    #[clap(global = true, short, long)]
    keypair_path: Option<String>,
    /// Optionally include your RPC endpoint. Use "local", "dev", "main" for default endpoints. Defaults to your Solana CLI config file.
    #[clap(global = true, short, long)]
    url: Option<String>,
    /// Optionally include a commitment level. Defaults to your Solana CLI config file.
    #[clap(global = true, short, long)]
    commitment: Option<String>,
}

#[derive(Subcommand, Debug)]
enum SubCommand {
    /// Creates a proof of work faucet on devnet
    Create {
        /// Prefix length
        #[clap(short, long)]
        difficulty: u8,
        /// Reward amount in SOL
        #[clap(long)]
        reward: f64,
    },
    /// Get all faucets
    GetAllFaucets,
    /// Get faucet address and balance
    GetFaucet {
        /// Prefix length
        #[clap(short, long)]
        difficulty: u8,
        /// Reward amount in SOL
        #[clap(long)]
        reward: f64,
    },
    /// Mine for SOL
    Mine {
        /// Prefix length
        #[clap(short, long)]
        difficulty: Option<u8>,
        #[clap(long)]
        /// Reward amount in SOL
        reward: Option<f64>,
        /// Target number of lamports to mine for
        #[clap(short, long, default_value = "10000000000")]
        target_lamports: u64,
        /// Stop after this many successful rewards
        #[clap(long)]
        max_rewards: Option<u64>,
        /// Re-evaluate the best faucet every N successful rewards
        #[clap(long)]
        rescan_every: Option<u64>,
        /// Automatically select the most efficient funded faucet
        #[clap(long, default_value = "false")]
        best: bool,
        /// Do not search for faucets automatically
        #[clap(long, default_value = "false")]
        no_infer: bool,
    },
}

const MIN_LEARNED_CLAIMS: u64 = 5;
const FULL_CONFIDENCE_CLAIMS: u64 = 25;
const MIN_LEARNED_RATIO: f64 = 0.25;
const MAX_LEARNED_RATIO: f64 = 4.0;
const MAX_RECENT_SAMPLES: usize = 50;
const EXPLORATION_FULLY_KNOWN_CLAIMS: u64 = 25;
const MAX_EXPLORATION_BONUS: f64 = 0.20;
const MAX_CONSECUTIVE_FAUCET_FAILURES: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct DifficultyPerformance {
    claims: u64,
    total_seconds: f64,
    gross_lamports: u64,
    #[serde(default)]
    recent_seconds: Vec<f64>,
}

impl DifficultyPerformance {
    fn average_seconds(&self) -> Option<f64> {
        if self.claims == 0 {
            None
        } else {
            Some(self.total_seconds / self.claims as f64)
        }
    }

    fn robust_seconds(&self) -> Option<f64> {
        const MIN_ROBUST_SAMPLES: usize = 5;

        if self.recent_seconds.len() < MIN_ROBUST_SAMPLES {
            return self.average_seconds();
        }

        let mut samples: Vec<f64> = self
            .recent_seconds
            .iter()
            .copied()
            .filter(|value| value.is_finite() && *value > 0.0)
            .collect();

        if samples.len() < MIN_ROBUST_SAMPLES {
            return self.average_seconds();
        }

        samples.sort_by(|a, b| a.partial_cmp(b).unwrap());

        // Trim 20% from both tails.
        let mut trim = samples.len() / 5;

        // Always leave at least 3 observations.
        while samples.len().saturating_sub(trim * 2) < 3 {
            if trim == 0 {
                break;
            }
            trim -= 1;
        }

        let kept = &samples[trim..samples.len() - trim];

        if kept.is_empty() {
            return self.average_seconds();
        }

        Some(kept.iter().sum::<f64>() / kept.len() as f64)
    }

    fn sol_per_second(&self) -> Option<f64> {
        if self.total_seconds <= 0.0 {
            None
        } else {
            Some((self.gross_lamports as f64 / 1e9) / self.total_seconds)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PerformanceHistory {
    difficulties: BTreeMap<u8, DifficultyPerformance>,
}

fn performance_history_path() -> PathBuf {
    PathBuf::from(".devnet-pow-performance.json")
}

fn load_performance_history() -> PerformanceHistory {
    let path = performance_history_path();

    match fs::read_to_string(&path) {
        Ok(contents) => match serde_json::from_str(&contents) {
            Ok(history) => history,
            Err(e) => {
                eprintln!(
                    "Warning: could not parse performance history {}: {}",
                    path.display(),
                    e
                );
                PerformanceHistory::default()
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => PerformanceHistory::default(),
        Err(e) => {
            eprintln!(
                "Warning: could not read performance history {}: {}",
                path.display(),
                e
            );
            PerformanceHistory::default()
        }
    }
}

fn save_performance_history(history: &PerformanceHistory) -> anyhow::Result<()> {
    let path = performance_history_path();
    let json = serde_json::to_string_pretty(history)?;
    fs::write(&path, json)?;
    Ok(())
}

#[derive(Debug, Clone, Copy, Default)]
pub struct FaucetMetadata {
    pub spec_pubkey: Pubkey,
    pub faucet_pubkey: Pubkey,
    pub difficulty: u8,
    pub amount: u64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Arguments::parse();
    let config = match CONFIG_FILE.as_ref() {
        Some(config_file) => Config::load(config_file).unwrap_or_else(|_| {
            println!("Failed to load config file: {}", config_file);
            Config::default()
        }),
        None => Config::default(),
    };
    let commitment =
        ConfigInput::compute_commitment_config("", &cli.commitment.unwrap_or(config.commitment)).1;
    let payer = get_payer_keypair_from_path(&cli.keypair_path.unwrap_or(config.keypair_path))?;
    let network_url = &get_network(&cli.url.unwrap_or(config.json_rpc_url)).to_string();
    let client = RpcClient::new_with_commitment(network_url.to_string(), commitment);

    let genesis = client.get_genesis_hash().await?;

    if !network_url.contains("localhost") && !network_url.contains("127.0.0.1") {
        match genesis.to_string().as_str() {
            "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" => {}
            _ => anyhow::bail!("Genesis hash does not correspond to devnet"),
        };
    }

    let program_id: Pubkey =
        if network_url.contains("localhost") || network_url.contains("127.0.0.1") {
            proof_of_work_faucet::id()
        } else {
            "PoWSNH2hEZogtCg1Zgm51FnkmJperzYDgPK4fvs8taL".parse::<Pubkey>()?
        };

    match cli.subcommand {
        SubCommand::Create { difficulty, reward } => {
            let amount: u64 = (reward * 1e9) as u64;
            let create_spec_data =
                proof_of_work_faucet::instruction::Create { difficulty, amount }.data();
            let (spec, _) = Pubkey::find_program_address(
                &[
                    b"spec",
                    difficulty.to_le_bytes().as_ref(),
                    amount.to_le_bytes().as_ref(),
                ],
                &program_id,
            );
            let (faucet, _) =
                Pubkey::find_program_address(&[b"source", spec.as_ref()], &program_id);
            if client.get_account(&spec).await.is_ok() {
                println!("Faucet already exists at {}", faucet);
                return Ok(());
            }
            let create_accounts = proof_of_work_faucet::accounts::Create {
                payer: payer.pubkey(),
                spec,
                system_program: solana_sdk::system_program::id(),
            };

            let ix = Instruction {
                program_id: program_id,
                accounts: create_accounts.to_account_metas(None),
                data: create_spec_data,
            };

            let transaction = solana_sdk::transaction::Transaction::new_signed_with_payer(
                &[ix],
                Some(&payer.pubkey()),
                &[&payer],
                client.get_latest_blockhash().await?,
            );

            let txid = client.send_and_confirm_transaction(&transaction).await?;
            println!(
                "Created proof of work faucet with difficulty {} and reward of {} SOL: {}",
                difficulty, reward, txid
            );
            println!("Faucet spec address: {}", spec);
            println!("Faucet address: {}", faucet);
            Ok(())
        }
        SubCommand::GetAllFaucets => {
            for FaucetMetadata {
                faucet_pubkey,
                difficulty,
                amount,
                ..
            } in get_all_faucets(&client, &commitment, program_id)
                .await?
                .iter()
            {
                let reward = *amount as f64 / 1e9;
                let balance = client
                    .get_balance_with_commitment(faucet_pubkey, commitment)
                    .await?
                    .value;
                println!("Faucet address: {}", faucet_pubkey);
                println!("Faucet balance: {} SOL", balance as f64 / 1e9);
                println!("Difficulty: {}", difficulty);
                println!("Reward: {}", reward);
                println!(
                    "Command: devnet-pow mine -d {} --reward {} -ud",
                    difficulty, reward
                );
                println!()
            }
            Ok(())
        }
        SubCommand::GetFaucet { difficulty, reward } => {
            let amount: u64 = (reward * 1e9) as u64;
            let (spec, _) = Pubkey::find_program_address(
                &[
                    b"spec",
                    difficulty.to_le_bytes().as_ref(),
                    amount.to_le_bytes().as_ref(),
                ],
                &program_id,
            );
            let (faucet, _) =
                Pubkey::find_program_address(&[b"source", spec.as_ref()], &program_id);
            println!("Faucet address: {}", faucet);

            let balance = client
                .get_balance_with_commitment(&faucet, commitment)
                .await?
                .value;
            println!("Faucet balance: {} SOL", balance as f64 / 1e9);
            Ok(())
        }
        SubCommand::Mine {
            difficulty,
            reward,
            target_lamports,
            max_rewards,
            rescan_every,
            best,
            no_infer,
        } => {
            let mut persistent_history = load_performance_history();

            let mut faucet_specs = if best {
                let selected =
                    select_best_faucet(&client, &commitment, program_id, &persistent_history)
                        .await?
                        .ok_or_else(|| anyhow!("No funded faucets found"))?;

                println!(
                    "Best faucet selected: {} | difficulty {} | reward {} SOL",
                    selected.faucet_pubkey,
                    selected.difficulty,
                    selected.amount as f64 / 1e9
                );

                let mut specs_for_difficulty = BTreeMap::new();
                specs_for_difficulty.insert(selected.amount, selected);

                let mut faucet_specs = BTreeMap::new();
                faucet_specs.insert(selected.difficulty, specs_for_difficulty);
                faucet_specs
            } else if no_infer {
                let mut faucet_specs = BTreeMap::new();
                match (difficulty, reward) {
                    (Some(d), Some(r)) => {
                        let mut spec = BTreeMap::new();
                        let reward_as_amount = (r * 1e9) as u64;
                        let (spec_pubkey, _) = Pubkey::find_program_address(
                            &[
                                b"spec",
                                d.to_le_bytes().as_ref(),
                                reward_as_amount.to_le_bytes().as_ref(),
                            ],
                            &program_id,
                        );
                        let (faucet_pubkey, _) = Pubkey::find_program_address(
                            &[b"source", spec_pubkey.as_ref()],
                            &program_id,
                        );

                        let metadata = FaucetMetadata {
                            spec_pubkey,
                            faucet_pubkey,
                            difficulty: d,
                            amount: reward_as_amount,
                        };

                        spec.insert(reward_as_amount, metadata);
                        faucet_specs.insert(d, spec);
                        faucet_specs
                    }
                    _ => {
                        return Err(anyhow!(
                            "Must specify difficulty and reward when using --no-infer"
                        ));
                    }
                }
            } else {
                get_inferred_faucets(&client, &commitment, difficulty, reward, program_id).await?
            };
            if faucet_specs.is_empty() {
                println!("No faucets found");
                return Ok(());
            }

            let payer_balance = client.get_balance(&payer.pubkey()).await?;

            if payer_balance < 5000 {}

            // This variable is used to short circuit the loop if the grinded key is below the minimum prefix length
            let mut min_prefix_len = *faucet_specs
                .keys()
                .min()
                .ok_or_else(|| anyhow!("No faucets found"))?;

            println!("Minimum difficulty: {}", min_prefix_len);
            println!("Setup complete! Starting mining process...");
            println!();
            let mut airdropped_amount = 0;
            let mut rewards_received: u64 = 0;
            let session_started = std::time::Instant::now();
            let starting_balance = payer_balance;
            let mut gross_rewards_lamports: u64 = 0;
            // difficulty -> (claims, total_seconds, gross_lamports)
            let mut performance_stats: BTreeMap<u8, (u64, f64, u64, Vec<f64>)> = BTreeMap::new();

            // Consecutive transaction failures per faucet during this session.
            let mut faucet_failures: BTreeMap<Pubkey, u32> = BTreeMap::new();

            // Consecutive infrastructure/RPC failures.
            // Never used to penalize a faucet.
            let mut rpc_failure_streak: u32 = 0;
            let mut last_reward_at = std::time::Instant::now();

            'mining: while airdropped_amount < target_lamports
                && max_rewards.map_or(true, |limit| rewards_received < limit)
            {
                let signer = Keypair::new();

                let prefix_len = encode(signer.pubkey().as_ref())
                    .into_string()
                    .chars()
                    .take_while(|ch| ch == &'A')
                    .count();

                if prefix_len < min_prefix_len as usize {
                    continue;
                }

                let mut candidate_faucets = vec![];
                faucet_specs
                    .iter()
                    .for_each(|(difficulty, specs_for_difficulty)| {
                        // Filter the faucets that meet the difficulty requirement
                        if *difficulty as usize <= prefix_len {
                            specs_for_difficulty.iter().for_each(|(_, spec)| {
                                candidate_faucets.push(*spec);
                            })
                        }
                    });
                candidate_faucets.sort_by(|spec1, spec2| {
                    if spec1.amount != spec2.amount {
                        spec1.amount.cmp(&spec2.amount)
                    } else {
                        spec1.difficulty.cmp(&spec2.difficulty)
                    }
                });

                if candidate_faucets.is_empty() {
                    println!("No candidate faucets found for {}", signer.pubkey());
                    continue;
                }

                println!("Keypair mined! Pubkey: {}: ", signer.pubkey());

                // Keep track of the difficulties that we've mined for the current key
                let mut matched_difficulties = vec![];

                // Try to claim the airdrop from each of the candidate faucets
                while !candidate_faucets.is_empty() {
                    let metadata = candidate_faucets.pop().unwrap();

                    if matched_difficulties.contains(&metadata.difficulty) {
                        continue;
                    }

                    if client
                        .get_balance_with_commitment(&metadata.faucet_pubkey, commitment)
                        .await?
                        .value
                        < metadata.amount
                    {
                        // Remove this key from the global list of faucets
                        println!("Faucet {} is empty", metadata.faucet_pubkey);
                        faucet_specs
                            .get_mut(&metadata.difficulty)
                            .unwrap()
                            .remove(&metadata.amount);

                        // Update min_prefix_len if necessary
                        if faucet_specs.get(&metadata.difficulty).unwrap().is_empty() {
                            faucet_specs.remove(&metadata.difficulty);
                            if metadata.difficulty == min_prefix_len {
                                if let Some(min) = faucet_specs.keys().min().copied() {
                                    min_prefix_len = min;
                                } else if best {
                                    println!("No faucets remaining locally; rescanning...");

                                    match select_best_faucet(
                                        &client,
                                        &commitment,
                                        program_id,
                                        &persistent_history,
                                    )
                                    .await?
                                    {
                                        Some(selected) => {
                                            println!(
                                                "New best faucet selected: {} | difficulty {} | reward {} SOL",
                                                selected.faucet_pubkey,
                                                selected.difficulty,
                                                selected.amount as f64 / 1e9
                                            );

                                            let mut specs_for_difficulty = BTreeMap::new();
                                            specs_for_difficulty.insert(selected.amount, selected);

                                            faucet_specs.clear();
                                            faucet_specs
                                                .insert(selected.difficulty, specs_for_difficulty);
                                            min_prefix_len = selected.difficulty;
                                        }
                                        None => {
                                            println!("No funded faucets found after rescan");
                                            break 'mining;
                                        }
                                    }
                                } else {
                                    println!("No faucets remaining");
                                    break 'mining;
                                }
                            }
                        }
                        continue;
                    }

                    let reward = metadata.amount as f64 / 1e9;
                    let (receipt, _) = Pubkey::find_program_address(
                        &[
                            b"receipt",
                            signer.pubkey().as_ref(),
                            metadata.difficulty.to_le_bytes().as_ref(),
                        ],
                        &program_id,
                    );
                    let airdrop_accounts = proof_of_work_faucet::accounts::Airdrop {
                        payer: payer.pubkey(),
                        signer: signer.pubkey(),
                        receipt,
                        spec: metadata.spec_pubkey,
                        source: metadata.faucet_pubkey,
                        system_program: solana_sdk::system_program::id(),
                    };

                    let ix = Instruction {
                        program_id: program_id,
                        accounts: airdrop_accounts.to_account_metas(None),
                        data: proof_of_work_faucet::instruction::Airdrop {}.data(),
                    };

                    let blockhash = match client.get_latest_blockhash().await {
                        Ok(blockhash) => {
                            rpc_failure_streak = 0;
                            blockhash
                        }
                        Err(e) => {
                            rpc_failure_streak = rpc_failure_streak.saturating_add(1);

                            let shift = rpc_failure_streak.saturating_sub(1).min(3);
                            let backoff_ms = 500_u64.saturating_mul(1_u64 << shift);

                            eprintln!("RPC error while getting latest blockhash: {}", e);
                            eprintln!(
                                "RPC retry backoff: {} ms (failure {})",
                                backoff_ms, rpc_failure_streak
                            );

                            tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;

                            continue;
                        }
                    };
                    let transaction = solana_sdk::transaction::Transaction::new_signed_with_payer(
                        &[ix],
                        Some(&payer.pubkey()),
                        &[&payer, &signer],
                        blockhash,
                    );

                    match client.send_and_confirm_transaction(&transaction).await {
                        Ok(txid) => {
                            println!(
                                "Received {} SOL from faucet {}: {}",
                                reward, metadata.faucet_pubkey, txid
                            );
                            airdropped_amount += metadata.amount;
                            rewards_received += 1;
                            gross_rewards_lamports += metadata.amount;

                            // Successful claim: reset this faucet's failure counter.
                            faucet_failures.remove(&metadata.faucet_pubkey);
                            rpc_failure_streak = 0;
                            let reward_elapsed = last_reward_at.elapsed().as_secs_f64();
                            let stats = performance_stats.entry(metadata.difficulty).or_insert((
                                0,
                                0.0,
                                0,
                                Vec::new(),
                            ));
                            stats.0 += 1;
                            stats.1 += reward_elapsed;
                            stats.2 += metadata.amount;
                            stats.3.push(reward_elapsed);
                            last_reward_at = std::time::Instant::now();
                            if best
                                && rescan_every.map_or(false, |interval| {
                                    interval > 0 && rewards_received % interval == 0
                                })
                            {
                                println!(
                                    "Periodic best-faucet rescan after {} rewards...",
                                    rewards_received
                                );

                                match select_best_faucet(
                                    &client,
                                    &commitment,
                                    program_id,
                                    &persistent_history,
                                )
                                .await?
                                {
                                    Some(selected) => {
                                        println!(
                                            "Best faucet now: {} | difficulty {} | reward {} SOL",
                                            selected.faucet_pubkey,
                                            selected.difficulty,
                                            selected.amount as f64 / 1e9
                                        );

                                        let mut specs_for_difficulty = BTreeMap::new();
                                        specs_for_difficulty.insert(selected.amount, selected);

                                        faucet_specs.clear();
                                        faucet_specs
                                            .insert(selected.difficulty, specs_for_difficulty);

                                        min_prefix_len = selected.difficulty;
                                    }
                                    None => {
                                        println!("No funded faucets found during periodic rescan");
                                        break 'mining;
                                    }
                                }
                            }
                            matched_difficulties.push(metadata.difficulty);
                        }
                        Err(e) => {
                            println!("Failed to receive airdrop: {}", e);

                            // A concrete transaction failure can reasonably be
                            // attributed to this claim/faucet. Transport and RPC
                            // infrastructure errors must not penalize the faucet.
                            let faucet_related = e.kind.get_transaction_error().is_some()
                                || matches!(&e.kind, ClientErrorKind::FaucetError(_));

                            if faucet_related {
                                rpc_failure_streak = 0;

                                let failures =
                                    faucet_failures.entry(metadata.faucet_pubkey).or_insert(0);

                                *failures += 1;

                                println!(
                                    "Faucet {} failure {}/{}",
                                    metadata.faucet_pubkey,
                                    *failures,
                                    MAX_CONSECUTIVE_FAUCET_FAILURES
                                );

                                if *failures >= MAX_CONSECUTIVE_FAUCET_FAILURES {
                                    println!(
                                        "Faucet {} temporarily disabled for this candidate set",
                                        metadata.faucet_pubkey
                                    );

                                    if let Some(specs) = faucet_specs.get_mut(&metadata.difficulty)
                                    {
                                        specs.remove(&metadata.amount);
                                    }

                                    if faucet_specs
                                        .get(&metadata.difficulty)
                                        .map_or(false, |specs| specs.is_empty())
                                    {
                                        faucet_specs.remove(&metadata.difficulty);

                                        if metadata.difficulty == min_prefix_len {
                                            if let Some(min) = faucet_specs.keys().min().copied() {
                                                min_prefix_len = min;
                                            }
                                        }
                                    }
                                }
                            } else {
                                rpc_failure_streak = rpc_failure_streak.saturating_add(1);

                                let shift = rpc_failure_streak.saturating_sub(1).min(3);

                                let backoff_ms = 500_u64.saturating_mul(1_u64 << shift);

                                let category = match &e.kind {
                                    ClientErrorKind::Io(_) => "I/O",
                                    ClientErrorKind::Reqwest(_) => "HTTP/transport",
                                    ClientErrorKind::RpcError(_) => "RPC",
                                    ClientErrorKind::SerdeJson(_) => "RPC parse",
                                    ClientErrorKind::SigningError(_) => "signing",
                                    ClientErrorKind::Custom(_) => "client/unknown",
                                    ClientErrorKind::TransactionError(_) => "transaction",
                                    ClientErrorKind::FaucetError(_) => "faucet",
                                };

                                eprintln!(
                                    "Non-faucet error ({}) - faucet {} not penalized",
                                    category, metadata.faucet_pubkey
                                );
                                eprintln!(
                                    "RPC/client retry backoff: {} ms (failure {})",
                                    backoff_ms, rpc_failure_streak
                                );

                                tokio::time::sleep(std::time::Duration::from_millis(backoff_ms))
                                    .await;
                            }

                            continue;
                        }
                    }
                }
            }
            let final_balance = client.get_balance(&payer.pubkey()).await?;
            let elapsed = session_started.elapsed();
            let net_change_lamports = final_balance as i128 - starting_balance as i128;
            let session_cost_lamports = gross_rewards_lamports as i128 - net_change_lamports;

            println!();
            println!("=== Session summary ===");
            println!("Rewards received: {}", rewards_received);
            println!(
                "Gross rewards: {:.9} SOL",
                gross_rewards_lamports as f64 / 1e9
            );
            println!("Starting balance: {:.9} SOL", starting_balance as f64 / 1e9);
            println!("Final balance: {:.9} SOL", final_balance as f64 / 1e9);
            println!(
                "Net balance change: {:.9} SOL",
                net_change_lamports as f64 / 1e9
            );
            println!(
                "Session cost: {:.9} SOL",
                session_cost_lamports as f64 / 1e9
            );
            println!("Elapsed time: {:.3} s", elapsed.as_secs_f64());
            if rewards_received > 0 {
                println!(
                    "Average time per reward: {:.3} s",
                    elapsed.as_secs_f64() / rewards_received as f64
                );
            }

            println!();
            println!("=== Measured profitability ===");
            for (difficulty, (claims, seconds, lamports, _recent_seconds)) in &performance_stats {
                if *claims == 0 || *seconds <= 0.0 {
                    continue;
                }

                let avg_seconds = *seconds / *claims as f64;
                let gross_sol = *lamports as f64 / 1e9;
                let sol_per_second = gross_sol / *seconds;
                let sol_per_hour = sol_per_second * 3600.0;

                println!(
                    "Difficulty {} | claims {} | avg {:.3} s | gross {:.9} SOL | {:.9} SOL/s | {:.6} SOL/h",
                    difficulty,
                    claims,
                    avg_seconds,
                    gross_sol,
                    sol_per_second,
                    sol_per_hour
                );
            }

            // Merge session measurements into persistent history
            for (difficulty, (claims, seconds, lamports, recent_seconds)) in &performance_stats {
                let history = persistent_history
                    .difficulties
                    .entry(*difficulty)
                    .or_default();

                history.claims += *claims;
                history.total_seconds += *seconds;
                history.gross_lamports += *lamports;

                history
                    .recent_seconds
                    .extend(recent_seconds.iter().copied());

                if history.recent_seconds.len() > MAX_RECENT_SAMPLES {
                    let excess = history.recent_seconds.len() - MAX_RECENT_SAMPLES;
                    history.recent_seconds.drain(0..excess);
                }
            }

            save_performance_history(&persistent_history)?;
            println!(
                "Performance history saved to {}",
                performance_history_path().display()
            );

            Ok(())
        }
    }
}

async fn select_best_faucet(
    client: &RpcClient,
    commitment: &CommitmentConfig,
    program_id: Pubkey,
    history: &PerformanceHistory,
) -> anyhow::Result<Option<FaucetMetadata>> {
    let all_faucets = get_all_faucets(client, commitment, program_id).await?;

    let mut best_faucet: Option<FaucetMetadata> = None;
    let mut best_score = f64::NEG_INFINITY;

    // Calibrate theoretical work against measured mining performance.
    let mut calibrated_seconds = 0.0_f64;
    let mut calibrated_work = 0.0_f64;

    for (difficulty, perf) in &history.difficulties {
        if perf.claims >= MIN_LEARNED_CLAIMS && perf.total_seconds > 0.0 {
            calibrated_seconds += perf.total_seconds;
            calibrated_work += perf.claims as f64 * 58_f64.powi(*difficulty as i32);
        }
    }

    let seconds_per_work_unit = if calibrated_work > 0.0 {
        Some(calibrated_seconds / calibrated_work)
    } else {
        None
    };

    for metadata in all_faucets {
        let balance = client
            .get_balance_with_commitment(&metadata.faucet_pubkey, *commitment)
            .await?
            .value;

        if balance < metadata.amount || metadata.amount < 895880 {
            continue;
        }

        let reward_sol = metadata.amount as f64 / 1e9;

        let theoretical_seconds = seconds_per_work_unit
            .map(|seconds_per_unit| seconds_per_unit * 58_f64.powi(metadata.difficulty as i32));

        let predicted_seconds = match history.difficulties.get(&metadata.difficulty) {
            Some(perf) if perf.claims >= MIN_LEARNED_CLAIMS && perf.total_seconds > 0.0 => {
                let learned_seconds = perf.robust_seconds();

                match (learned_seconds, theoretical_seconds) {
                    (Some(learned), Some(theoretical)) if learned > 0.0 && theoretical > 0.0 => {
                        // Confidence grows gradually from the minimum
                        // sample threshold to FULL_CONFIDENCE_CLAIMS.
                        let confidence = if perf.claims >= FULL_CONFIDENCE_CLAIMS {
                            1.0
                        } else {
                            let learned_range =
                                (FULL_CONFIDENCE_CLAIMS - MIN_LEARNED_CLAIMS) as f64;

                            ((perf.claims - MIN_LEARNED_CLAIMS) as f64 / learned_range)
                                .clamp(0.0, 1.0)
                        };

                        // Prevent a small number of anomalous sessions
                        // from producing an extreme learned estimate.
                        let min_seconds = theoretical * MIN_LEARNED_RATIO;
                        let max_seconds = theoretical * MAX_LEARNED_RATIO;

                        let protected_learned = learned.clamp(min_seconds, max_seconds);

                        let blended =
                            theoretical * (1.0 - confidence) + protected_learned * confidence;

                        println!(
                                "Learning: difficulty {} | claims {} | confidence {:.0}% | robust {:.3}s | blended {:.3}s",
                                metadata.difficulty,
                                perf.claims,
                                confidence * 100.0,
                                learned,
                                blended
                            );

                        Some(blended)
                    }

                    (Some(learned), None) if learned > 0.0 => Some(learned),

                    (_, theoretical) => theoretical,
                }
            }

            _ => theoretical_seconds,
        };

        let score = match predicted_seconds {
            Some(seconds) if seconds > 0.0 => {
                let sol_per_second = reward_sol / seconds;

                println!(
                    "Profit estimate: difficulty {} | reward {:.9} SOL | {:.3}s expected | {:.9} SOL/s",
                    metadata.difficulty,
                    reward_sol,
                    seconds,
                    sol_per_second
                );

                sol_per_second
            }
            _ => {
                // No sufficient measured history yet.
                metadata.amount as f64 / 58_f64.powi(metadata.difficulty as i32)
            }
        };

        // Controlled exploration:
        // poorly measured difficulties receive a small deterministic
        // optimism bonus, capped at MAX_EXPLORATION_BONUS.
        //
        // This does NOT force exploration of clearly unprofitable
        // difficulties; it only breaks close calls in favour of
        // gathering more information.
        let historical_claims = history
            .difficulties
            .get(&metadata.difficulty)
            .map(|perf| perf.claims)
            .unwrap_or(0);

        let exploration_bonus = if historical_claims >= EXPLORATION_FULLY_KNOWN_CLAIMS {
            0.0
        } else {
            MAX_EXPLORATION_BONUS
                * (1.0 - historical_claims as f64 / EXPLORATION_FULLY_KNOWN_CLAIMS as f64)
        };

        let adjusted_score = score * (1.0 + exploration_bonus);

        if exploration_bonus > 0.0 {
            println!(
                "Exploration: difficulty {} | claims {} | bonus +{:.1}% | base {:.9} | adjusted {:.9}",
                metadata.difficulty,
                historical_claims,
                exploration_bonus * 100.0,
                score,
                adjusted_score
            );
        }

        if adjusted_score > best_score {
            best_score = adjusted_score;
            best_faucet = Some(metadata);
        }
    }

    Ok(best_faucet)
}

async fn get_all_faucets(
    client: &RpcClient,
    commitment: &CommitmentConfig,
    program_id: Pubkey,
) -> anyhow::Result<Vec<FaucetMetadata>> {
    let config = RpcProgramAccountsConfig {
        filters: Some(vec![RpcFilterType::DataSize(17)]),
        account_config: RpcAccountInfoConfig {
            encoding: Some(UiAccountEncoding::Binary),
            commitment: Some(*commitment),
            ..RpcAccountInfoConfig::default()
        },
        ..RpcProgramAccountsConfig::default()
    };
    let specs = client
        .get_program_accounts_with_config(&program_id, config)
        .await?
        .iter()
        .filter_map(|(pubkey, account)| {
            let difficulty = Difficulty::try_from_slice(&account.data[8..]).ok()?;
            let (faucet, _) =
                Pubkey::find_program_address(&[b"source", pubkey.as_ref()], &program_id);
            Some(FaucetMetadata {
                spec_pubkey: *pubkey,
                faucet_pubkey: faucet,
                difficulty: difficulty.difficulty,
                amount: difficulty.amount,
            })
        })
        .collect_vec();
    Ok(specs)
}

async fn get_inferred_faucets(
    client: &RpcClient,
    commitment: &CommitmentConfig,
    difficulty: Option<u8>,
    reward: Option<f64>,
    program_id: Pubkey,
) -> anyhow::Result<BTreeMap<u8, BTreeMap<u64, FaucetMetadata>>> {
    let mut faucet_specs = get_all_faucets(client, commitment, program_id)
        .await?
        .iter()
        .filter(|spec_metadata| {
            if let Some(difficulty) = difficulty {
                if spec_metadata.difficulty < difficulty {
                    return false;
                }
            }
            if let Some(reward) = reward {
                let reward_as_amount = (reward * 1e9) as u64;
                if spec_metadata.amount < reward_as_amount {
                    return false;
                }
            }
            // Ignore specs that are not profitable to mine
            if spec_metadata.amount < 895880 {
                return false;
            }
            true
        })
        .group_by(|spec_metadata| spec_metadata.difficulty)
        .into_iter()
        .map(|(key, group)| {
            let specs_for_difficulty = group
                .map(|spec| (spec.amount, *spec))
                .collect::<BTreeMap<u64, FaucetMetadata>>();
            (key, specs_for_difficulty)
        })
        .collect::<BTreeMap<u8, BTreeMap<u64, FaucetMetadata>>>();

    let mut keys_to_remove = vec![];

    for (difficulty, specs_for_difficulty) in faucet_specs.iter() {
        for (amount, spec) in specs_for_difficulty.iter() {
            // Make sure this is a valid faucet
            match client.get_account(&spec.spec_pubkey).await {
                Ok(acc) => {
                    if acc.data.is_empty() {
                        keys_to_remove.push((*difficulty, *amount));
                    }
                }
                Err(_) => {
                    keys_to_remove.push((*difficulty, *amount));
                }
            }
            let balaance = client
                .get_balance_with_commitment(&spec.faucet_pubkey, *commitment)
                .await?
                .value;
            if balaance < *amount {
                keys_to_remove.push((*difficulty, *amount));
            }
        }
    }

    // Clean up all invalid faucets
    let mut difficulties_to_remove = vec![];
    for (difficulty, amount) in keys_to_remove {
        faucet_specs.get_mut(&difficulty).unwrap().remove(&amount);
        if faucet_specs.get(&difficulty).unwrap().is_empty() {
            difficulties_to_remove.push(difficulty);
        }
    }
    for difficulty in difficulties_to_remove {
        faucet_specs.remove(&difficulty);
    }

    Ok(faucet_specs)
}
