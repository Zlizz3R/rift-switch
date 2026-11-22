//! Encryption.
//! - Files on this PC (saved logins, Riot Client sessions): Windows DPAPI, only this Windows
//!   user can read them. Files of the old Electron version ("v10" + AES-GCM with a key kept in
//!   its "Local State" file) are still read, and main.rs re-encrypts them with DPAPI once, so
//!   nothing depends on that leftover file any more.
//! - Password-based, independent of this PC: logins inside an export file (scrypt + AES-256-GCM)
//!   and the app lock (salted scrypt hash, constant-time compare). Same format as before.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::OnceLock;
use subtle::ConstantTimeEq;

// ---------- DPAPI ----------

#[cfg(windows)]
fn dpapi(data: &[u8], protect: bool) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut out = CRYPT_INTEGER_BLOB::default();
    unsafe {
        let r = if protect {
            CryptProtectData(&input, None, None, None, None, 0, &mut out)
        } else {
            CryptUnprotectData(&input, None, None, None, None, 0, &mut out)
        };
        r.ok()?;
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(out.pbData as _));
        Some(v)
    }
}
#[cfg(not(windows))]
fn dpapi(_data: &[u8], _protect: bool) -> Option<Vec<u8>> {
    None
}

/// The AES key of the old Electron version (its "Local State" file in the data folder), if any.
fn electron_key(data_dir: &Path) -> Option<&'static [u8; 32]> {
    static KEY: OnceLock<Option<[u8; 32]>> = OnceLock::new();
    KEY.get_or_init(|| {
        let text = std::fs::read_to_string(data_dir.join("Local State")).ok()?;
        let v: Value = serde_json::from_str(&text).ok()?;
        let enc = B64.decode(v["os_crypt"]["encrypted_key"].as_str()?).ok()?;
        let blob = enc.strip_prefix(b"DPAPI")?;
        let key = dpapi(blob, false)?;
        key.try_into().ok()
    })
    .as_ref()
}

pub fn encrypt_local(plain: &[u8]) -> Option<Vec<u8>> {
    dpapi(plain, true)
}
/// Written by the old Electron version (needs its "Local State" key to read)?
pub fn is_legacy(blob: &[u8]) -> bool {
    blob.starts_with(b"v10")
}

pub fn decrypt_local(data_dir: &Path, blob: &[u8]) -> Option<Vec<u8>> {
    if let Some(rest) = blob.strip_prefix(b"v10") {
        let key = electron_key(data_dir)?;
        if rest.len() < 12 + 16 {
            return None;
        }
        return Aes256Gcm::new(key.into())
            .decrypt(Nonce::from_slice(&rest[..12]), &rest[12..])
            .ok();
    }
    dpapi(blob, false)
}

// ---------- password boxes (export file) and the app lock ----------

const SEAL_LOG_N: u8 = 15;
const LOCK_LOG_N: u8 = 14;

fn scrypt_key(pass: &str, salt: &[u8], log_n: u8) -> [u8; 32] {
    let mut key = [0u8; 32];
    let params = scrypt::Params::new(log_n, 8, 1, 32).expect("scrypt params");
    scrypt::scrypt(pass.as_bytes(), salt, &params, &mut key).expect("scrypt");
    key
}
fn random<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    rand::thread_rng().fill_bytes(&mut b);
    b
}

pub fn seal(obj: &Value, pass: &str) -> Value {
    let (salt, iv) = (random::<16>(), random::<12>());
    let key = scrypt_key(pass, &salt, SEAL_LOG_N);
    let mut ct = Aes256Gcm::new(&key.into())
        .encrypt(
            Nonce::from_slice(&iv),
            Payload::from(obj.to_string().as_bytes()),
        )
        .expect("encrypt");
    let tag = ct.split_off(ct.len() - 16);
    json!({ "kdf": "scrypt", "N": 1u32 << SEAL_LOG_N, "salt": B64.encode(salt), "iv": B64.encode(iv),
            "tag": B64.encode(tag), "data": B64.encode(ct) })
}

/// None for a wrong password or a damaged/foreign box.
pub fn open(bx: &Value, pass: &str) -> Option<Value> {
    if bx.get("kdf")?.as_str()? != "scrypt" || bx.get("N")?.as_u64()? != 1u64 << SEAL_LOG_N {
        return None;
    }
    let d = |k: &str| B64.decode(bx.get(k)?.as_str()?).ok();
    let (salt, iv, tag, data) = (d("salt")?, d("iv")?, d("tag")?, d("data")?);
    if iv.len() != 12 {
        return None;
    }
    let key = scrypt_key(pass, &salt, SEAL_LOG_N);
    let mut ct = data;
    ct.extend(tag);
    let plain = Aes256Gcm::new(&key.into())
        .decrypt(Nonce::from_slice(&iv), ct.as_slice())
        .ok()?;
    serde_json::from_slice(&plain).ok()
}

pub fn make_lock(pass: &str) -> Value {
    let salt = random::<16>();
    json!({ "salt": B64.encode(salt), "hash": B64.encode(scrypt_key(pass, &salt, LOCK_LOG_N)) })
}

// ---------- logins sealed with the app password (optional) ----------
// The key comes from the app password with its own salt ("ksalt"), so the stored lock hash says
// nothing about it. It only lives in memory while the app is unlocked.

pub type Key = [u8; 32];
const SEALED: &[u8] = b"RSK1";

pub fn new_key_salt() -> String {
    B64.encode(random::<16>())
}
pub fn login_key(pass: &str, ksalt: &str) -> Option<Key> {
    let salt = B64.decode(ksalt).ok()?;
    Some(scrypt_key(pass, &salt, LOCK_LOG_N))
}
pub fn is_sealed(b: &[u8]) -> bool {
    b.starts_with(SEALED)
}
pub fn seal_bytes(key: &Key, plain: &[u8]) -> Vec<u8> {
    let nonce = random::<12>();
    let ct = Aes256Gcm::new(key.into())
        .encrypt(Nonce::from_slice(&nonce), plain)
        .expect("encrypt");
    [SEALED, &nonce[..], &ct].concat()
}
pub fn open_bytes(key: &Key, b: &[u8]) -> Option<Vec<u8>> {
    let rest = b.strip_prefix(SEALED)?;
    if rest.len() < 12 + 16 {
        return None;
    }
    Aes256Gcm::new(key.into())
        .decrypt(Nonce::from_slice(&rest[..12]), &rest[12..])
        .ok()
}

// ---------- Windows Hello: "is it really you?" before a saved password is shown ----------

/// Ok(true) = confirmed (PIN, fingerprint, face or Windows password), Ok(false) = cancelled,
/// Err = Windows Hello isn't set up on this PC.
#[cfg(windows)]
pub fn windows_confirm(hwnd: isize, message: &str) -> Result<bool, String> {
    use windows::core::HSTRING;
    use windows::Foundation::IAsyncOperation;
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::{
        IUserConsentVerifierInterop, RoInitialize, RO_INIT_MULTITHREADED,
    };
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let avail = UserConsentVerifier::CheckAvailabilityAsync()
        .and_then(|op| op.get())
        .map_err(|e| e.to_string())?;
    if avail != UserConsentVerifierAvailability::Available {
        return Err("unavailable".into());
    }
    let interop = windows::core::factory::<UserConsentVerifier, IUserConsentVerifierInterop>()
        .map_err(|e| e.to_string())?;
    let op: IAsyncOperation<UserConsentVerificationResult> = unsafe {
        interop.RequestVerificationForWindowAsync(HWND(hwnd as _), &HSTRING::from(message))
    }
    .map_err(|e| e.to_string())?;
    Ok(op.get().map_err(|e| e.to_string())? == UserConsentVerificationResult::Verified)
}
pub fn lock_matches(lock: Option<&Value>, pass: Option<&str>) -> bool {
    let (Some(lock), Some(pass)) = (lock, pass) else {
        return false;
    };
    let (Some(salt), Some(hash)) = (
        lock.get("salt")
            .and_then(Value::as_str)
            .and_then(|s| B64.decode(s).ok()),
        lock.get("hash")
            .and_then(Value::as_str)
            .and_then(|s| B64.decode(s).ok()),
    ) else {
        return false;
    };
    let a = scrypt_key(pass, &salt, LOCK_LOG_N);
    a.len() == hash.len() && bool::from(a.ct_eq(hash.as_slice()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sealed_logins() {
        let bx = seal(
            &json!({ "logins": [{ "u": "a", "p": "b" }] }),
            "correct horse",
        );
        assert_eq!(
            open(&bx, "correct horse"),
            Some(json!({ "logins": [{ "u": "a", "p": "b" }] }))
        );
        assert_eq!(open(&bx, "wrong"), None);
        let mut bad = bx.clone();
        let d = bad["data"].as_str().unwrap().to_string();
        bad["data"] = json!(format!("{}AAAA", &d[..d.len() - 4]));
        assert_eq!(open(&bad, "correct horse"), None);
        assert!(!bx.to_string().contains("\"b\""));
    }
    #[test]
    fn app_lock() {
        let l = make_lock("1234");
        assert!(lock_matches(Some(&l), Some("1234")));
        assert!(!lock_matches(Some(&l), Some("12345")));
        assert!(!lock_matches(Some(&l), None));
        assert!(!lock_matches(None, Some("1234")));
        assert_ne!(make_lock("1234")["salt"], l["salt"]);
    }
    #[test]
    fn sealed_logins_need_the_key() {
        let ks = new_key_salt();
        let k = login_key("1234", &ks).unwrap();
        let b = seal_bytes(&k, b"{\"u\":\"a\",\"p\":\"b\"}");
        assert!(is_sealed(&b));
        assert_eq!(open_bytes(&k, &b).unwrap(), b"{\"u\":\"a\",\"p\":\"b\"}");
        assert!(open_bytes(&login_key("12345", &ks).unwrap(), &b).is_none());
        assert!(open_bytes(&login_key("1234", &new_key_salt()).unwrap(), &b).is_none());
        // the key is not the stored lock hash
        let lock = make_lock("1234");
        assert_ne!(B64.encode(k), lock["hash"].as_str().unwrap());
    }
    #[test]
    fn node_compatible_box() {
        // made by the old version (Node crypto.scryptSync + aes-256-gcm), see test/fixtures
        let bx: Value =
            serde_json::from_str(include_str!("../../test/fixtures/sealed.json")).unwrap();
        assert_eq!(
            open(&bx, "correct horse"),
            Some(json!({ "logins": [{ "u": "a", "p": "b" }] }))
        );
    }
    #[test]
    fn dpapi_round_trip() {
        let dir = std::env::temp_dir().join("rs-secrets-test-none");
        let enc = encrypt_local(b"rift-switch").unwrap();
        assert!(!is_legacy(&enc));
        assert_eq!(decrypt_local(&dir, &enc).unwrap(), b"rift-switch");
    }
}
