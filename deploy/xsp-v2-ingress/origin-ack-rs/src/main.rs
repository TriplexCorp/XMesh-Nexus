use serde::Deserialize;
use std::env;
use std::ffi::c_void;
use std::fs;
use std::io::{self, Read, Write};
use std::net::Shutdown;
use std::os::fd::AsRawFd;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEFAULT_SOCKET: &str = "/run/xmesh-origin/xsp-v2-origin.sock";
const DEFAULT_C2C_SOCKET: &str = "/run/xmesh-c2c/c2c.sock";
const DEFAULT_INGRESS_UID: u32 = 10003;
const DEFAULT_INGRESS_GID: u32 = 10003;
const C2C_UID: u32 = 10001;
const C2C_GID: u32 = 10001;
const ACK_PATH: &str = "/api/v2/node/keys/rotation/ack";
const RECOVERY_PATH: &str = "/api/v2/node/keys/rotation/ack/recovery";
const IDENTITY_PATH: &str = "/identity-probe";
const MAX_CERT_HEADER: usize = 24 * 1024;
const MAX_HTTP_HEADERS: usize = 32 * 1024;
const MAX_ACK_BODY: usize = 16 * 1024;
const MAX_SIGNATURE_TEXT: usize = 8 * 1024;
const OPENSSL_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
const C2C_TIMEOUT: Duration = Duration::from_secs(12);
const C2C_REQUEST_MAGIC: &[u8; 8] = b"XSP2C2C1";
const C2C_RECOVERY_REQUEST_MAGIC: &[u8; 8] = b"XSP2C2H1";
const C2C_RESPONSE_MAGIC: &[u8; 8] = b"XSP2C2R1";

const SOL_SOCKET: i32 = 1;
const SO_PEERCRED: i32 = 17;

#[repr(C)]
struct UCred {
    pid: i32,
    uid: u32,
    gid: u32,
}

unsafe extern "C" {
    fn getsockopt(
        socket: i32,
        level: i32,
        option_name: i32,
        option_value: *mut c_void,
        option_len: *mut u32,
    ) -> i32;
    fn umask(mask: u32) -> u32;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TestFault {
    None,
    DropBeforeC2c,
    DropOnC2cFailure,
    DropAfterC2cSuccess,
}

impl TestFault {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "" => Ok(Self::None),
            "drop-before-c2c" => Ok(Self::DropBeforeC2c),
            "drop-on-c2c-failure" => Ok(Self::DropOnC2cFailure),
            "drop-after-c2c-success" => Ok(Self::DropAfterC2cSuccess),
            _ => {
                Err("XSP_V2_C2D_TEST_FAULT is not an approved disposable E2E fault mode".to_owned())
            }
        }
    }
}

#[derive(Debug)]
struct Config {
    socket_path: PathBuf,
    expected_uid: u32,
    expected_gid: u32,
    expected_spki: String,
    expected_node_id: u64,
    ack_gate: String,
    c2c_gate: String,
    recovery_gate: String,
    c2c_socket_path: PathBuf,
    test_fault: TestFault,
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let socket_path = PathBuf::from(
            env::var("XSP_ORIGIN_SOCKET").unwrap_or_else(|_| DEFAULT_SOCKET.to_owned()),
        );
        let expected_uid = parse_env_u32("XSP_EXPECTED_INGRESS_UID", DEFAULT_INGRESS_UID)?;
        let expected_gid = parse_env_u32("XSP_EXPECTED_INGRESS_GID", DEFAULT_INGRESS_GID)?;
        let expected_spki = env::var("XSP_EXPECTED_CLIENT_SPKI_SHA256")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        if expected_spki.len() != 64
            || !expected_spki
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        {
            return Err("XSP_EXPECTED_CLIENT_SPKI_SHA256 must be lowercase SHA-256 hex".to_owned());
        }
        let expected_node_id = env::var("XSP_EXPECTED_NODE_ID")
            .unwrap_or_default()
            .trim()
            .parse::<u64>()
            .map_err(|_| "XSP_EXPECTED_NODE_ID must be a positive integer".to_owned())?;
        if expected_node_id == 0 {
            return Err("XSP_EXPECTED_NODE_ID must be a positive integer".to_owned());
        }

        let ack_gate = env::var("XSP_V2_C2B_ACK_ROUTE").unwrap_or_default();
        let c2c_gate = env::var("XSP_V2_C2C_ACK_AUTH").unwrap_or_default();
        if c2c_gate != "" && c2c_gate != "staging-only" {
            return Err("XSP_V2_C2C_ACK_AUTH must be unset or staging-only".to_owned());
        }
        let recovery_gate = env::var("XSP_V2_C2D_HISTORICAL_RECOVERY").unwrap_or_default();
        if recovery_gate != "" && recovery_gate != "staging-only" {
            return Err("XSP_V2_C2D_HISTORICAL_RECOVERY must be unset or staging-only".to_owned());
        }
        let c2c_socket_path = PathBuf::from(
            env::var("XSP_V2_C2C_SOCKET_PATH").unwrap_or_else(|_| DEFAULT_C2C_SOCKET.to_owned()),
        );
        let test_fault =
            TestFault::parse(env::var("XSP_V2_C2D_TEST_FAULT").unwrap_or_default().trim())?;
        if test_fault != TestFault::None && c2c_gate != "staging-only" {
            return Err("C2-D2 test faults require the explicit staging-only C2-C gate".to_owned());
        }

        Ok(Self {
            socket_path,
            expected_uid,
            expected_gid,
            expected_spki,
            expected_node_id,
            ack_gate,
            c2c_gate,
            recovery_gate,
            c2c_socket_path,
            test_fault,
        })
    }
}

fn parse_env_u32(name: &str, default: u32) -> Result<u32, String> {
    match env::var(name) {
        Ok(value) => value
            .trim()
            .parse::<u32>()
            .map_err(|_| format!("{name} must be an unsigned integer")),
        Err(_) => Ok(default),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AckEnvelope {
    message: AckMessage,
    signatures: AckSignatures,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AckSignatures {
    ed25519: String,
    mldsa65: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AckMessage {
    kind: String,
    #[serde(rename = "issuerId")]
    issuer_id: String,
    #[serde(rename = "signerEdKeyId")]
    signer_ed_key_id: String,
    #[serde(rename = "signerPQKeyId")]
    signer_pq_key_id: String,
    #[serde(rename = "nodeId")]
    node_id: u64,
    #[serde(rename = "fromEpoch")]
    from_epoch: u64,
    #[serde(rename = "toEpoch")]
    to_epoch: u64,
    #[serde(rename = "requestId")]
    request_id: String,
    #[serde(rename = "fromEdKeyId")]
    from_ed_key_id: String,
    #[serde(rename = "fromPQKeyId")]
    from_pq_key_id: String,
    #[serde(rename = "toEdKeyId")]
    to_ed_key_id: String,
    #[serde(rename = "toPQKeyId")]
    to_pq_key_id: String,
    method: String,
    path: String,
    #[serde(rename = "issuedAtMs")]
    issued_at_ms: i64,
    #[serde(rename = "expiresAtMs")]
    expires_at_ms: i64,
    #[serde(rename = "permitNonceHex")]
    permit_nonce_hex: String,
    #[serde(rename = "nonceHex")]
    nonce_hex: String,
    #[serde(rename = "candidateSha256Hex")]
    candidate_sha256_hex: String,
    #[serde(rename = "permitSha256Hex")]
    permit_sha256_hex: String,
    #[serde(rename = "appliedStateSha256Hex")]
    applied_state_sha256_hex: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ValidationError {
    Invalid,
    RecoveryNotExpired,
}

fn validate_envelope(
    envelope: &AckEnvelope,
    trusted_node_id: u64,
    recovery: bool,
    now_ms: i64,
) -> Result<(), ValidationError> {
    let message = &envelope.message;
    let signatures = &envelope.signatures;

    if signatures.ed25519.is_empty()
        || signatures.ed25519.chars().count() > MAX_SIGNATURE_TEXT
        || signatures.mldsa65.is_empty()
        || signatures.mldsa65.chars().count() > MAX_SIGNATURE_TEXT
    {
        return Err(ValidationError::Invalid);
    }

    let expected_issuer = format!("node-{trusted_node_id}");
    let Some(expected_to_epoch) = message.from_epoch.checked_add(1) else {
        return Err(ValidationError::Invalid);
    };
    let Some(validity_ms) = message.expires_at_ms.checked_sub(message.issued_at_ms) else {
        return Err(ValidationError::Invalid);
    };
    if message.kind != "ack"
        || message.node_id != trusted_node_id
        || message.issuer_id != expected_issuer
        || message.method != "POST"
        || message.path != ACK_PATH
        || message.from_epoch == 0
        || message.to_epoch != expected_to_epoch
        || message.issued_at_ms <= 0
        || message.expires_at_ms <= message.issued_at_ms
        || validity_ms > 60_000
    {
        return Err(ValidationError::Invalid);
    }

    if recovery {
        if now_ms <= message.expires_at_ms {
            return Err(ValidationError::RecoveryNotExpired);
        }
    } else {
        let skew = (i128::from(now_ms) - i128::from(message.issued_at_ms)).abs();
        if skew > 120_000 || now_ms > message.expires_at_ms {
            return Err(ValidationError::Invalid);
        }
    }

    for value in [
        &message.request_id,
        &message.issuer_id,
        &message.signer_ed_key_id,
        &message.signer_pq_key_id,
        &message.from_ed_key_id,
        &message.from_pq_key_id,
        &message.to_ed_key_id,
        &message.to_pq_key_id,
    ] {
        if !bounded_ascii(value, 64) {
            return Err(ValidationError::Invalid);
        }
    }

    if message.signer_ed_key_id != message.to_ed_key_id
        || message.signer_pq_key_id != message.to_pq_key_id
    {
        return Err(ValidationError::Invalid);
    }

    if !canonical_hex(&message.permit_nonce_hex, 16)
        || !canonical_hex(&message.nonce_hex, 16)
        || message.nonce_hex == message.permit_nonce_hex
        || !canonical_hex(&message.candidate_sha256_hex, 32)
        || !canonical_hex(&message.permit_sha256_hex, 32)
        || !canonical_hex(&message.applied_state_sha256_hex, 32)
    {
        return Err(ValidationError::Invalid);
    }

    Ok(())
}

fn canonical_hex(value: &str, bytes: usize) -> bool {
    value.len() == bytes * 2
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        && value.bytes().any(|byte| byte != b'0')
}

fn bounded_ascii(value: &str, maximum: usize) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= maximum
        && bytes.iter().all(|byte| (0x21..=0x7e).contains(byte))
}

fn current_time_ms() -> Result<i64, String> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "system time is before Unix epoch".to_owned())?;
    i64::try_from(duration.as_millis())
        .map_err(|_| "system time exceeds i64 milliseconds".to_owned())
}

fn peer_credentials(stream: &UnixStream) -> Result<(u32, u32), String> {
    let mut credentials = UCred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut length = std::mem::size_of::<UCred>() as u32;
    // SAFETY: `credentials` is writable for exactly `length` bytes and the file
    // descriptor belongs to this live Unix stream. Linux SO_PEERCRED writes a
    // `struct ucred` with pid/uid/gid in the represented C layout.
    let result = unsafe {
        getsockopt(
            stream.as_raw_fd(),
            SOL_SOCKET,
            SO_PEERCRED,
            (&mut credentials as *mut UCred).cast::<c_void>(),
            &mut length,
        )
    };
    if result != 0 || length as usize != std::mem::size_of::<UCred>() {
        return Err("cannot read Unix peer credentials".to_owned());
    }
    Ok((credentials.uid, credentials.gid))
}

fn percent_decode(value: &str) -> Vec<u8> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
            {
                output.push((high << 4) | low);
                index += 3;
                continue;
            }
        }
        output.push(bytes[index]);
        index += 1;
    }
    output
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn run_openssl(args: &[&str], input: &[u8]) -> Result<Vec<u8>, String> {
    let mut child = Command::new("openssl")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "cannot execute OpenSSL".to_owned())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(input)
            .map_err(|_| "cannot write OpenSSL input".to_owned())?;
    }

    let deadline = Instant::now() + OPENSSL_TIMEOUT;
    let status = loop {
        match child
            .try_wait()
            .map_err(|_| "cannot wait for OpenSSL".to_owned())?
        {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("OpenSSL timed out".to_owned());
            }
            None => thread::sleep(Duration::from_millis(10)),
        }
    };
    if !status.success() {
        return Err("OpenSSL rejected input".to_owned());
    }
    let mut output = Vec::new();
    child
        .stdout
        .take()
        .ok_or_else(|| "missing OpenSSL output".to_owned())?
        .read_to_end(&mut output)
        .map_err(|_| "cannot read OpenSSL output".to_owned())?;
    if output.is_empty() {
        return Err("empty OpenSSL output".to_owned());
    }
    Ok(output)
}

fn spki_sha256(cert_pem: &[u8]) -> Result<String, String> {
    let public_key = run_openssl(&["x509", "-pubkey", "-noout"], cert_pem)
        .map_err(|_| "invalid client certificate".to_owned())?;
    let der = run_openssl(&["pkey", "-pubin", "-outform", "DER"], &public_key)
        .map_err(|_| "invalid client public key".to_owned())?;
    let digest = run_openssl(&["dgst", "-sha256", "-binary"], &der)
        .map_err(|_| "cannot hash client public key".to_owned())?;
    if digest.len() != 32 {
        return Err("invalid SHA-256 output".to_owned());
    }
    Ok(to_hex(&digest))
}

fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    initial_body: Vec<u8>,
}

impl HttpRequest {
    fn header(&self, name: &str) -> Result<Option<&str>, ()> {
        let mut matches = self
            .headers
            .iter()
            .filter(|(key, _)| key.eq_ignore_ascii_case(name));
        let first = matches.next().map(|(_, value)| value.as_str());
        if matches.next().is_some() {
            return Err(());
        }
        Ok(first)
    }
}

fn read_request(stream: &mut UnixStream) -> Result<HttpRequest, String> {
    stream
        .set_read_timeout(Some(REQUEST_TIMEOUT))
        .map_err(|_| "cannot set request timeout".to_owned())?;
    let mut bytes = Vec::with_capacity(4096);
    let mut buffer = [0_u8; 2048];
    let header_end = loop {
        let read = stream
            .read(&mut buffer)
            .map_err(|_| "cannot read HTTP request".to_owned())?;
        if read == 0 {
            return Err("truncated HTTP request".to_owned());
        }
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.len() > MAX_HTTP_HEADERS + MAX_ACK_BODY {
            return Err("HTTP request too large".to_owned());
        }
        if let Some(position) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            if position + 4 > MAX_HTTP_HEADERS {
                return Err("HTTP headers too large".to_owned());
            }
            break position + 4;
        }
        if bytes.len() > MAX_HTTP_HEADERS {
            return Err("HTTP headers too large".to_owned());
        }
    };

    let header_text = std::str::from_utf8(&bytes[..header_end - 4])
        .map_err(|_| "non-UTF-8 HTTP headers".to_owned())?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "missing request line".to_owned())?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| "missing method".to_owned())?
        .to_owned();
    let path = parts
        .next()
        .ok_or_else(|| "missing path".to_owned())?
        .to_owned();
    let version = parts
        .next()
        .ok_or_else(|| "missing HTTP version".to_owned())?;
    if parts.next().is_some() || (version != "HTTP/1.0" && version != "HTTP/1.1") {
        return Err("invalid request line".to_owned());
    }

    let mut headers = Vec::new();
    for line in lines {
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| "invalid HTTP header".to_owned())?;
        let name = name.trim();
        if name.is_empty()
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err("invalid HTTP header name".to_owned());
        }
        headers.push((name.to_owned(), value.trim().to_owned()));
    }

    Ok(HttpRequest {
        method,
        path,
        headers,
        initial_body: bytes[header_end..].to_vec(),
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BodyError {
    Invalid,
    Timeout,
}

fn read_body(stream: &mut UnixStream, initial: &[u8], length: usize) -> Result<Vec<u8>, BodyError> {
    if initial.len() > length {
        return Err(BodyError::Invalid);
    }
    let mut body = Vec::with_capacity(length);
    body.extend_from_slice(initial);
    let mut buffer = [0_u8; 2048];
    while body.len() < length {
        let remaining = length - body.len();
        match stream.read(&mut buffer[..remaining.min(buffer.len())]) {
            Ok(0) => return Err(BodyError::Invalid),
            Ok(read) => body.extend_from_slice(&buffer[..read]),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
                ) =>
            {
                return Err(BodyError::Timeout);
            }
            Err(_) => return Err(BodyError::Timeout),
        }
    }
    Ok(body)
}

fn trusted_node_id(stream: &UnixStream, request: &HttpRequest, config: &Config) -> Option<u64> {
    let (uid, gid) = peer_credentials(stream).ok()?;
    if uid != config.expected_uid || gid != config.expected_gid {
        return None;
    }
    if request.header("X-XSP-V2-Client-Verify").ok().flatten() != Some("SUCCESS") {
        return None;
    }
    let escaped = request.header("X-XSP-V2-Client-Cert").ok().flatten()?;
    if escaped.is_empty() || escaped.len() > MAX_CERT_HEADER {
        return None;
    }
    let fingerprint = spki_sha256(&percent_decode(escaped)).ok()?;
    if fingerprint != config.expected_spki {
        return None;
    }
    Some(config.expected_node_id)
}

fn authorize_c2c(
    config: &Config,
    node_id: u64,
    raw_ack: &[u8],
    recovery: bool,
) -> Result<Vec<u8>, String> {
    if node_id == 0 || raw_ack.is_empty() || raw_ack.len() > MAX_ACK_BODY {
        return Err("invalid C2-C local request".to_owned());
    }
    let magic = if recovery {
        C2C_RECOVERY_REQUEST_MAGIC
    } else {
        C2C_REQUEST_MAGIC
    };
    let length = u32::try_from(raw_ack.len()).map_err(|_| "ACK body exceeds u32".to_owned())?;
    let mut frame = Vec::with_capacity(20 + raw_ack.len());
    frame.extend_from_slice(magic);
    frame.extend_from_slice(&node_id.to_be_bytes());
    frame.extend_from_slice(&length.to_be_bytes());
    frame.extend_from_slice(raw_ack);

    let mut client = UnixStream::connect(&config.c2c_socket_path)
        .map_err(|_| "cannot connect to C2-C service".to_owned())?;
    client
        .set_read_timeout(Some(C2C_TIMEOUT))
        .map_err(|_| "cannot set C2-C read timeout".to_owned())?;
    client
        .set_write_timeout(Some(C2C_TIMEOUT))
        .map_err(|_| "cannot set C2-C write timeout".to_owned())?;
    let (uid, gid) = peer_credentials(&client)?;
    if uid != C2C_UID || gid != C2C_GID {
        return Err("unexpected C2-C service peer".to_owned());
    }
    client
        .write_all(&frame)
        .map_err(|_| "cannot write C2-C request".to_owned())?;
    client
        .shutdown(Shutdown::Write)
        .map_err(|_| "cannot finish C2-C request".to_owned())?;

    let mut header = [0_u8; 13];
    read_exact(&mut client, &mut header)?;
    if &header[..8] != C2C_RESPONSE_MAGIC || !matches!(header[8], 0 | 1) {
        return Err("invalid C2-C response domain".to_owned());
    }
    let response_length =
        u32::from_be_bytes(header[9..13].try_into().expect("4-byte slice")) as usize;
    if response_length > MAX_ACK_BODY {
        return Err("C2-C response too large".to_owned());
    }
    let mut payload = vec![0_u8; response_length];
    read_exact(&mut client, &mut payload)?;
    let mut trailing = [0_u8; 1];
    match client.read(&mut trailing) {
        Ok(0) => {}
        Ok(_) => return Err("trailing C2-C response bytes".to_owned()),
        Err(_) => return Err("C2-C response did not terminate".to_owned()),
    }
    if header[8] != 1 || payload.is_empty() {
        return Err("C2-C authorization rejected".to_owned());
    }
    Ok(payload)
}

fn read_exact(stream: &mut UnixStream, output: &mut [u8]) -> Result<(), String> {
    let mut offset = 0;
    while offset < output.len() {
        match stream.read(&mut output[offset..]) {
            Ok(0) => return Err("truncated C2-C response".to_owned()),
            Ok(read) => offset += read,
            Err(_) => return Err("truncated C2-C response".to_owned()),
        }
    }
    Ok(())
}

fn send_response(stream: &mut UnixStream, status: u16, content_type: &str, body: &[u8]) {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        408 => "Request Timeout",
        409 => "Conflict",
        411 => "Length Required",
        413 => "Content Too Large",
        415 => "Unsupported Media Type",
        503 => "Service Unavailable",
        _ => "Error",
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn send_json(stream: &mut UnixStream, status: u16, body: &str) {
    send_response(stream, status, "application/json", body.as_bytes());
}

fn error_json(message: &str) -> String {
    format!(
        r#"{{"error":{}}}"#,
        serde_json::to_string(message).expect("static error string")
    )
}

fn drop_response(stream: &UnixStream) {
    let _ = stream.shutdown(Shutdown::Both);
}

fn handle_connection(mut stream: UnixStream, config: &Config) {
    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(_) => {
            send_json(&mut stream, 400, &error_json("invalid request"));
            return;
        }
    };

    match request.method.as_str() {
        "GET" => handle_get(&mut stream, &request, config),
        "POST" => handle_post(&mut stream, request, config),
        _ => send_json(&mut stream, 404, &error_json("not found")),
    }
}

fn handle_get(stream: &mut UnixStream, request: &HttpRequest, config: &Config) {
    if request.path != IDENTITY_PATH {
        send_json(stream, 404, &error_json("not found"));
        return;
    }
    let Some(node_id) = trusted_node_id(stream, request, config) else {
        send_json(stream, 403, &error_json("untrusted origin identity"));
        return;
    };
    let body = format!(r#"{{"originTransport":"unix-peercred","trustedNodeId":{node_id}}}"#);
    send_json(stream, 200, &body);
}

fn handle_post(stream: &mut UnixStream, request: HttpRequest, config: &Config) {
    let recovery = request.path == RECOVERY_PATH;
    if (request.path != ACK_PATH && request.path != RECOVERY_PATH)
        || config.ack_gate != "staging-only"
    {
        send_json(stream, 404, &error_json("not found"));
        return;
    }
    if recovery && config.recovery_gate != "staging-only" {
        send_json(stream, 404, &error_json("historical recovery unavailable"));
        return;
    }

    let Some(node_id) = trusted_node_id(stream, &request, config) else {
        send_json(stream, 403, &error_json("untrusted origin identity"));
        return;
    };
    if request.header("Content-Type").ok().flatten() != Some("application/json") {
        send_json(stream, 415, &error_json("unsupported media type"));
        return;
    }
    let raw_length = match request.header("Content-Length") {
        Ok(Some(value)) if value.bytes().all(|byte| byte.is_ascii_digit()) && !value.is_empty() => {
            value
        }
        _ => {
            send_json(stream, 411, &error_json("content length required"));
            return;
        }
    };
    let length = match raw_length.parse::<usize>() {
        Ok(length) if (1..=MAX_ACK_BODY).contains(&length) => length,
        _ => {
            send_json(stream, 413, &error_json("invalid body size"));
            return;
        }
    };
    let raw = match read_body(stream, &request.initial_body, length) {
        Ok(raw) => raw,
        Err(BodyError::Timeout) => {
            send_json(stream, 408, &error_json("request timeout"));
            return;
        }
        Err(BodyError::Invalid) => {
            send_json(stream, 400, &error_json("invalid staging ACK"));
            return;
        }
    };

    let envelope: AckEnvelope = match serde_json::from_slice(&raw) {
        Ok(envelope) => envelope,
        Err(_) => {
            send_json(stream, 400, &error_json("invalid staging ACK"));
            return;
        }
    };
    let now_ms = match current_time_ms() {
        Ok(now_ms) => now_ms,
        Err(_) => {
            send_json(stream, 400, &error_json("invalid staging ACK"));
            return;
        }
    };
    match validate_envelope(&envelope, node_id, recovery, now_ms) {
        Ok(()) => {}
        Err(ValidationError::RecoveryNotExpired) => {
            send_json(
                stream,
                409,
                &error_json("historical recovery requires expired ACK"),
            );
            return;
        }
        Err(ValidationError::Invalid) => {
            send_json(stream, 400, &error_json("invalid staging ACK"));
            return;
        }
    }

    if config.c2c_gate == "staging-only" {
        if !recovery && config.test_fault == TestFault::DropBeforeC2c {
            drop_response(stream);
            return;
        }
        let receipt = match authorize_c2c(config, node_id, &raw, recovery) {
            Ok(receipt) => receipt,
            Err(_) => {
                if !recovery && config.test_fault == TestFault::DropOnC2cFailure {
                    drop_response(stream);
                    return;
                }
                send_json(
                    stream,
                    503,
                    &error_json("C2-C authorization unavailable or rejected"),
                );
                return;
            }
        };
        if !recovery && config.test_fault == TestFault::DropAfterC2cSuccess {
            drop_response(stream);
            return;
        }
        send_response(stream, 200, "application/json", &receipt);
        return;
    }

    if recovery {
        send_json(stream, 404, &error_json("historical recovery unavailable"));
        return;
    }
    let body = format!(
        r#"{{"acceptedStage":"c2b-structural-gate","authorizationStatus":"not-verified","trustedNodeId":{node_id}}}"#
    );
    send_json(stream, 202, &body);
}

fn bind_listener(path: &Path) -> Result<UnixListener, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create socket directory: {error}"))?;
    }
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("cannot remove stale origin socket: {error}")),
    }

    // SAFETY: process umask is changed only around the synchronous bind and is
    // restored immediately afterwards. The resulting socket is chmod'd to the
    // exact 0660 contract before accepting requests.
    let previous_umask = unsafe { umask(0o117) };
    let listener = UnixListener::bind(path);
    // SAFETY: restore the exact mask returned by the preceding umask call.
    unsafe {
        umask(previous_umask);
    }
    let listener = listener.map_err(|error| format!("cannot bind origin socket: {error}"))?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o660))
        .map_err(|error| format!("cannot chmod origin socket: {error}"))?;
    Ok(listener)
}

fn run() -> Result<(), String> {
    let config = Arc::new(Config::from_env()?);
    let listener = bind_listener(&config.socket_path)?;
    for connection in listener.incoming() {
        match connection {
            Ok(stream) => {
                let config = Arc::clone(&config);
                thread::spawn(move || handle_connection(stream, &config));
            }
            Err(error) => eprintln!("xsp-origin-ack-gate: accept failed: {error}"),
        }
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("xsp-origin-ack-gate: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AckEnvelope, TestFault, ValidationError, bounded_ascii, canonical_hex, validate_envelope,
    };

    fn valid_json() -> String {
        r#"{
          "message": {
            "kind":"ack",
            "issuerId":"node-4242",
            "signerEdKeyId":"ed-next",
            "signerPQKeyId":"pq-next",
            "nodeId":4242,
            "fromEpoch":7,
            "toEpoch":8,
            "requestId":"req-1",
            "fromEdKeyId":"ed-old",
            "fromPQKeyId":"pq-old",
            "toEdKeyId":"ed-next",
            "toPQKeyId":"pq-next",
            "method":"POST",
            "path":"/api/v2/node/keys/rotation/ack",
            "issuedAtMs":1000000,
            "expiresAtMs":1060000,
            "permitNonceHex":"11111111111111111111111111111111",
            "nonceHex":"22222222222222222222222222222222",
            "candidateSha256Hex":"1111111111111111111111111111111111111111111111111111111111111111",
            "permitSha256Hex":"2222222222222222222222222222222222222222222222222222222222222222",
            "appliedStateSha256Hex":"3333333333333333333333333333333333333333333333333333333333333333"
          },
          "signatures":{"ed25519":"sig-ed","mldsa65":"sig-pq"}
        }"#
        .to_owned()
    }

    #[test]
    fn strict_schema_accepts_exact_envelope() {
        let envelope: AckEnvelope = serde_json::from_str(&valid_json()).expect("valid envelope");
        assert_eq!(validate_envelope(&envelope, 4242, false, 1_000_000), Ok(()));
    }

    #[test]
    fn duplicate_and_unknown_fields_fail_closed() {
        let duplicate = valid_json().replace(r#""kind":"ack","#, r#""kind":"ack","kind":"ack","#);
        assert!(serde_json::from_str::<AckEnvelope>(&duplicate).is_err());
        let unknown = valid_json().replace(r#""kind":"ack","#, r#""kind":"ack","unexpected":1,"#);
        assert!(serde_json::from_str::<AckEnvelope>(&unknown).is_err());
    }

    #[test]
    fn recovery_requires_expired_ack() {
        let envelope: AckEnvelope = serde_json::from_str(&valid_json()).expect("valid envelope");
        assert_eq!(
            validate_envelope(&envelope, 4242, true, 1_060_000),
            Err(ValidationError::RecoveryNotExpired)
        );
        assert_eq!(validate_envelope(&envelope, 4242, true, 1_060_001), Ok(()));
    }

    #[test]
    fn canonical_fields_remain_strict() {
        assert!(canonical_hex("11111111111111111111111111111111", 16));
        assert!(!canonical_hex("00000000000000000000000000000000", 16));
        assert!(!canonical_hex("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", 16));
        assert!(bounded_ascii("key-id", 64));
        assert!(!bounded_ascii("with space", 64));
    }

    #[test]
    fn fault_modes_are_allowlisted() {
        assert!(TestFault::parse("").is_ok());
        assert!(TestFault::parse("drop-before-c2c").is_ok());
        assert!(TestFault::parse("drop-on-c2c-failure").is_ok());
        assert!(TestFault::parse("drop-after-c2c-success").is_ok());
        assert!(TestFault::parse("skip-auth").is_err());
    }
}
