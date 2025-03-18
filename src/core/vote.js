const { ethers, provider } = require('../services/ethereum');
const { sleep } = require('../utils/time');
const { chalk } = require('../utils/logger');
const { logWithBorder } = require('../utils/logger');
const { VOTE_ADDRESS, VOTE_ABI, REQUIRED_CONFIRMATIONS, MAX_RETRIES, RETRY_DELAY } = require('../constants');
const { fetchTaikoPoints } = require('../services/points');
const { getCurrentServerTime } = require('../utils/time');
const config = require('../../config/config.json');

const publicRpcList = require('../../config/publicRpc.json').checker_rpc;
const publicProviders = publicRpcList.map(url => new ethers.providers.JsonRpcProvider(url));

const walletFees = new Map();
const walletPoints = new Map();

let currentProviderIndex = 0;
function getNextPublicProvider() {
    const provider = publicProviders[currentProviderIndex];
    currentProviderIndex = (currentProviderIndex + 1) % publicProviders.length;
    return provider;
}

async function waitForAllConfirmations(transactions, requiredConfirmations) {
    const confirmationStates = new Map(
        transactions.map(({ hash, walletIndex }) => [hash, { confirmations: 0, walletIndex }])
    );

    process.stdout.write(chalk.yellow(`${"-".repeat(100)}\n⏳ Waiting for confirmations...\n`));

    const confirmedReceipts = [];

    while (confirmationStates.size > 0) {
        try {
            let statusLine = "";
            await Promise.all(
                Array.from(confirmationStates.entries()).map(async ([txHash, state]) => {
                    const publicProvider = getNextPublicProvider();
                    let receipt = null;
                    for (let retry = 0; retry < 5; retry++) {
                        receipt = await publicProvider.getTransactionReceipt(txHash);
                        if (receipt && receipt.blockNumber) break;
                        await sleep(3000);
                    }

                    if (!receipt || !receipt.blockNumber) {
                        statusLine += chalk.yellow(`[Wallet-${state.walletIndex + 1}: Pending] `);
                        return;
                    }

                    const currentBlock = await publicProvider.getBlockNumber();
                    const confirmations = Math.max(currentBlock - receipt.blockNumber + 1, 0);

                    if (confirmations >= requiredConfirmations) {
                        const mainReceipt = await provider.getTransactionReceipt(txHash);
                        confirmationStates.delete(txHash);
                        if (mainReceipt) {
                            confirmedReceipts.push({ receipt: mainReceipt, walletIndex: state.walletIndex });
                        } else {
                            console.log(chalk.red(`❌ Failed to fetch receipt for txHash: ${txHash}`));
                        }
                    } else {
                        statusLine += chalk.yellow(`[Wallet-${state.walletIndex + 1}: ${confirmations}/${requiredConfirmations} blocks] `);
                    }
                })
            );

            process.stdout.write(`\r${" ".repeat(100)}\r${statusLine}`);

            if (confirmationStates.size > 0) {
                await sleep(5000);
            }
        } catch (error) {
            await sleep(5000);
        }
    }

    console.log(chalk.green(`\n✓ All transactions confirmed!\n${"-".repeat(100)}`));
    return confirmedReceipts;
}

async function executeTransactions(operations, description) {
    const transactions = [];

    console.log(chalk.cyan(`📤 Executing ${description}...`));

    await Promise.all(
        operations.map(async ({ operation, walletIndex }) => {
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    const tx = await operation();
                    console.log(chalk.yellow(`🔄 Wallet-${walletIndex + 1} ${description} Hash:`), chalk.blue(tx.hash));
                    transactions.push({ hash: tx.hash, walletIndex });
                    break;
                } catch (error) {
                    logWithBorder(chalk.red(`✗ Wallet-${walletIndex + 1} - Attempt ${attempt} failed: ${error.message}`));
                    if (attempt === MAX_RETRIES) {
                        throw new Error(`Failed after ${MAX_RETRIES} attempts`);
                    }
                    console.log(chalk.yellow(`⏳ Waiting ${RETRY_DELAY / 1000} seconds before retry...`));
                    await sleep(RETRY_DELAY);
                }
            }
        })
    );

    const confirmedReceipts = await waitForAllConfirmations(transactions, REQUIRED_CONFIRMATIONS);

    confirmedReceipts.forEach(({ receipt, walletIndex }) => {
        if (!receipt) {
            console.log(chalk.red(`❌ Wallet-${walletIndex + 1}: Transaction receipt is null!`));
            return;
        }
        if (receipt.status === 0) {
            console.log(chalk.red(`❌ Wallet-${walletIndex + 1}: Transaction ${receipt.transactionHash} failed!`));
            return;
        }
        const actualFee = receipt.gasUsed.mul(receipt.effectiveGasPrice);
        const currentWalletFee = walletFees.get(walletIndex) || ethers.BigNumber.from(0);
        walletFees.set(walletIndex, currentWalletFee.add(actualFee));
    });

    return confirmedReceipts;
}

async function processVoteWallets(walletConfigs, iteration) {
    logWithBorder(
        chalk.cyan(`📌 [${getCurrentServerTime()}] Starting Vote iteration ${iteration + 1}`)
    );
    // Implementation of processVoteWallets...
}

module.exports = {
    processVoteWallets,
    executeTransactions,
    waitForAllConfirmations,
    walletFees,
    walletPoints
};
