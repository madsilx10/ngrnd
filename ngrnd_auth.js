const { ethers } = require("ethers");
const fs = require("fs");
const readline = require("readline");
const crypto = require("crypto");

const ENV_ID = "0fd00f8e-684e-4257-8e3a-a9c86ac897ff";
const BASE = `https://app.dynamicauth.com/api/v0/sdk/${ENV_ID}`;
const ORIGIN = "https://quests.ngrnd.io";
const DOMAIN = "quests.ngrnd.io";
const CHAIN_ID = "8453";
const REF_CODE = "0x9cc66A64"; // dari link onboard lo

// --- X (Twitter) OAuth config ---
const X_CLIENT_ID = "TTNLYVZkektJYzl1QVBSNENQbkw6MTpjaQ";
const X_REDIRECT_URI = `https://app.dynamicauth.com/api/v0/sdk/${ENV_ID}/providers/twitter/redirect`;
const X_SCOPE = "offline.access tweet.read users.email users.read";
const X_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAnNwIzUejRCOuH5E6l8xnZz4puTs%3D1Zv7ttfk8LF81lUq16cHjhLTvJu4FA33AGWWjCpTnA";

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function genPkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function genXState() {
  return base64url(crypto.randomBytes(24));
}

async function applyReferral(jwt, address, index) {
  try {
    const res = await fetch(`${ORIGIN}/api/user?referredBy=${REF_CODE}`, {
      method: "GET",
      headers: {
        ...HEADERS_COMMON,
        authorization: `Bearer ${jwt}`,
        referer: `${ORIGIN}/dashboard`,
      },
    });
    console.log(`[${index}] [${address}] referral status:`, res.status);
    console.log(`[${index}] [${address}] referral headers:`, JSON.stringify([...res.headers.entries()]));
    const data = await res.json();
    console.log(`[${index}] [${address}] referral response FULL:`, JSON.stringify(data));
    const ok = data.referredBy === REF_CODE;
    if (!ok) {
      console.log(`[${index}] [${address}] referral FAILED:`, JSON.stringify(data).slice(0, 200));
    } else {
      console.log(`[${index}] [${address}] referral -> OK`);
    }
    return ok;
  } catch (err) {
    console.log(`[${index}] [${address}] referral ERROR:`, err.message);
    return false;
  }
}

async function connectX(authToken, ct0, jwt, address, index) {
  console.log(`[${index}] [${address}] connecting X...`);
  const { verifier, challenge } = genPkce();
  const state = genXState();
  const cookieHeader = `auth_token=${authToken}; ct0=${ct0}`;

  const authorizeReferer =
    `https://x.com/i/oauth2/authorize?client_id=${X_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(X_REDIRECT_URI)}&response_type=code` +
    `&scope=${encodeURIComponent(X_SCOPE)}&state=${state}` +
    `&code_challenge=${challenge}&code_challenge_method=S256`;

  try {
    const res = await fetch("https://x.com/i/api/2/oauth2/authorize", {
      method: "POST",
      headers: {
        authorization: `Bearer ${X_BEARER}`,
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookieHeader,
        "x-csrf-token": ct0,
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-client-language": "en",
        referer: authorizeReferer,
        "user-agent": HEADERS_COMMON["user-agent"],
      },
      body: new URLSearchParams({
        approval: "true",
        client_id: X_CLIENT_ID,
        redirect_uri: X_REDIRECT_URI,
        response_type: "code",
        scope: X_SCOPE,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString(),
    });

    const data = await res.json();
    if (!data.redirect_uri) {
      console.log(`[${index}] [${address}] X connect FAILED:`, JSON.stringify(data).slice(0, 300));
      return false;
    }

    const redirectUrl = new URL(data.redirect_uri);
    const code = redirectUrl.searchParams.get("code");
    const returnedState = redirectUrl.searchParams.get("state");

    const dynamicCallbackUrl = `${X_REDIRECT_URI}?code=${code}&state=${returnedState}&code_verifier=${verifier}`;
    const exchangeRes = await fetch(dynamicCallbackUrl, {
      method: "GET",
      headers: {
        "user-agent": HEADERS_COMMON["user-agent"],
        authorization: `Bearer ${jwt}`,
      },
      redirect: "manual",
    });

    const ok = exchangeRes.status < 400;
    console.log(`[${index}] [${address}] X connect -> ${ok ? "OK" : "FAILED"} (${exchangeRes.status})`);
    return ok;
  } catch (err) {
    console.log(`[${index}] [${address}] X connect ERROR:`, err.message);
    return false;
  }
}

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
    `URI: ${ORIGIN}/profile\n` +
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

async function processAccount(privateKey, index, xAuthToken, xCt0) {
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

      // 5. referral di-skip (harus manual lewat browser, gak bisa dari script)
      const referralOk = null;

      // 6. connect X (kalau cookie tersedia)
      let xConnected = false;
      if (xAuthToken && xCt0) {
        xConnected = await connectX(xAuthToken, xCt0, verifyData.jwt, address, index);
      } else {
        console.log(`[${index}] [${address}] skip X connect (no cookie)`);
      }

      return { address, jwt: verifyData.jwt, minifiedJwt: verifyData.minifiedJwt, xConnected, referral: referralOk };
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
  const mode = { type: null };

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

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

async function promptMode(totalAkun) {
  console.log("Pilih mode:");
  console.log("  1. Satu akun");
  console.log("  2. Semua akun");
  console.log("  3. Dari akun X sampai Y");
  const pilih = await ask("Masukkan pilihan (1/2/3): ");

  if (pilih === "1") {
    const nomor = await ask(`Nomor akun (1-${totalAkun}): `);
    return { type: "single", account: parseInt(nomor, 10) };
  } else if (pilih === "3") {
    const from = await ask("Dari akun nomor: ");
    const to = await ask("Sampai akun nomor: ");
    return { type: "range", from: parseInt(from, 10), to: parseInt(to, 10) };
  }
  return { type: "all" };
}

async function loadXCookies() {
  if (!fs.existsSync("xcookies.txt")) return [];
  const lines = fs
    .readFileSync("xcookies.txt", "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const cookies = [];
  for (let i = 0; i < lines.length; i += 2) {
    cookies.push({ authToken: lines[i], ct0: lines[i + 1] });
  }
  return cookies;
}

async function main() {
  const allKeys = fs
    .readFileSync("privkeys.txt", "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const xCookies = await loadXCookies();

  let mode = parseArgs();
  if (!mode.type) {
    mode = await promptMode(allKeys.length);
  }
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
    const xCookie = xCookies[idx - 1] || null;
    const res = await processAccount(key, idx, xCookie?.authToken, xCookie?.ct0);
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
