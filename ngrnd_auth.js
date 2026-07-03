const { ethers } = require("ethers");
const fs = require("fs");

const ENV_ID = "0fd00f8e-684e-4257-8e3a-a9c86ac897ff";
const BASE = `https://app.dynamicauth.com/api/v0/sdk/${ENV_ID}`;
const ORIGIN = "https://quests.ngrnd.io";
const DOMAIN = "quests.ngrnd.io";
const CHAIN_ID = "8453";
const REF_CODE = "0x9cc66A64"; // dari link onboard lo

const HEADERS_COMMON = {
  "accept": "*/*",
  "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "content-type": "application/json",
  "origin": ORIGIN,
  "referer": ORIGIN + "/",
  "x-dyn-api-version": "API/0.0.927",
  "x-dyn-is-global-wallet-popup": "false",
  "x-dyn-version": "WalletKit/4.77.2",
  "user-agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

function randHex(len) {
  const chars = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * 16)];
  return out;
}

function buildSiweMessage(address, nonce) {
  const issuedAt = new Date().toISOString().replace(/\.\d+Z$/, ".000Z");
  return (
    `${DOMAIN} wants you to sign in with your Ethereum account:\n` +
    `${address}\n\n` +
    `Welcome to Loyalty. Signing is the only way we can truly know that you are the owner of the wallet you are connecting. Signing is a safe, gas-less transaction that does not in any way give Loyalty permission to perform any transactions with your wallet.\n\n` +
    `URI: ${ORIGIN}/dashboard\n` +
    `Version: 1\n` +
    `Chain ID: ${CHAIN_ID}\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}\n` +
    `Request ID: ${ENV_ID}`
  );
}

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function processAccount(privateKey, index) {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;
  console.log(`\n[${index}] [${address}] starting...`);

  const deviceFingerprint = randHex(32);

  try {
    // 1. connect
    const connectPayload = {
      address,
      authMode: "connect-and-sign",
      chain: "EVM",
      provider: "browserExtension",
      walletName: "metamask",
    };
    const connectRes = await fetch(`${BASE}/connect`, {
      method: "POST",
      headers: {
        ...HEADERS_COMMON,
        "x-dyn-device-fingerprint": deviceFingerprint,
        "x-dyn-request-id": randHex(32),
      },
      body: JSON.stringify(connectPayload),
    });
    console.log(`[${index}] [${address}] connect -> ${connectRes.status}`);

    // 2. nonce
    const nonceRes = await fetch(`${BASE}/nonce`, {
      method: "GET",
      headers: {
        ...HEADERS_COMMON,
        "x-dyn-device-fingerprint": deviceFingerprint,
        "x-dyn-request-id": randHex(32),
      },
    });
    const nonceData = await nonceRes.json();
    const nonce = nonceData.nonce;
    console.log(`[${index}] [${address}] nonce -> ${nonce}`);

    // 3. sign SIWE message
    const message = buildSiweMessage(address, nonce);
    const signedMessage = await wallet.signMessage(message);

    // 4. verify
    const sessionWallet = ethers.Wallet.createRandom();
    const verifyPayload = {
      signedMessage,
      messageToSign: message,
      publicWalletAddress: address,
      chain: "EVM",
      walletName: "metamask",
      walletProvider: "browserExtension",
      network: CHAIN_ID,
      additionalWalletAddresses: [],
      sessionPublicKey: sessionWallet.publicKey.slice(2), // dummy, server kayaknya gak strict validasi ini
    };

    const verifyRes = await fetch(`${BASE}/verify`, {
      method: "POST",
      headers: {
        ...HEADERS_COMMON,
        "x-dyn-device-fingerprint": deviceFingerprint,
        "x-dyn-request-id": randHex(32),
        "x-dyn-session-public-key": sessionWallet.publicKey.slice(2),
      },
      body: JSON.stringify(verifyPayload),
    });

    const verifyData = await verifyRes.json();

    if (verifyRes.status === 200 && verifyData.jwt) {
      console.log(`[${index}] [${address}] SUCCESS, jwt acquired`);
      return { address, jwt: verifyData.jwt, minifiedJwt: verifyData.minifiedJwt };
    } else {
      console.log(`[${index}] [${address}] FAILED:`, JSON.stringify(verifyData).slice(0, 300));
      return null;
    }
  } catch (err) {
    console.log(`[${index}] [${address}] ERROR:`, err.message);
    return null;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const mode = { type: "all" };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--account") {
      mode.type = "single";
      mode.account = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--all") {
      mode.type = "all";
    } else if (args[i] === "--from") {
      mode.type = "range";
      mode.from = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--to") {
      mode.to = parseInt(args[i + 1], 10);
      i++;
    }
  }
  return mode;
}

async function main() {
  const allKeys = fs
    .readFileSync("privkeys.txt", "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const mode = parseArgs();
  let selected = [];

  if (mode.type === "single") {
    if (mode.account < 1 || mode.account > allKeys.length) {
      console.log(`Akun #${mode.account} gak ada. Total akun: ${allKeys.length}`);
      return;
    }
    selected = [{ key: allKeys[mode.account - 1], idx: mode.account }];
  } else if (mode.type === "range") {
    const from = mode.from || 1;
    const to = mode.to || allKeys.length;
    for (let i = from; i <= to && i <= allKeys.length; i++) {
      selected.push({ key: allKeys[i - 1], idx: i });
    }
  } else {
    selected = allKeys.map((key, i) => ({ key, idx: i + 1 }));
  }

  console.log(`Mode: ${mode.type}. Akan proses ${selected.length} akun.`);

  const results = [];
  for (const { key, idx } of selected) {
    const res = await processAccount(key, idx);
    results.push(res);
    await sleep(2000 + Math.random() * 2000);
  }

  const successCount = results.filter((r) => r).length;
  console.log(`\nDone. ${successCount}/${selected.length} success.`);

  let existing = [];
  if (fs.existsSync("results.json")) {
    try {
      existing = JSON.parse(fs.readFileSync("results.json", "utf-8"));
    } catch (e) {}
  }
  const combined = existing.concat(results.filter((r) => r));
  fs.writeFileSync("results.json", JSON.stringify(combined, null, 2));
  console.log("Hasil disimpan ke results.json");
}

main();
