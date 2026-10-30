use std::env;
use std::ffi::c_void;
use std::fs;
use std::io::{Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const DEFAULT_SOCKET: &str = "/run/xmesh-origin/xsp-v2-origin.sock";
const DEFAULT_INGRESS_UID: u32 = 10003;
const DEFAULT_INGRESS_GID: u32 = 10003;
const MAX_CERT_HEADER: usize = 24 * 1024;
const MAX_HTTP_HEADERS: usize = 32 * 1024;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);

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

#[derive(Debug)]
struct Config {
    socket_path: PathBuf,
    expected_uid: u32,
    expected_gid: u32,
    expected_spki: String,
    expected_node_id: u64,
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
            || !expected_spki.bytes().all(|byte| byte.is_ascii_hexdigit())
            || expected_spki.bytes().any(|byte| byte.is_ascii_uppercase())
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
        Ok(Self {
            socket_path,
            expected_uid,
            expected_gid,
            expected_spki,
            expected_node_id,
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

fn peer_credentials(stream: &UnixStream) -> Result<(u32, u32), String> {
    let mut credentials = UCred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut length = std::mem::size_of::<UCred>() as u32;
    // SAFETY: `credentials` is writable for exactly `length` bytes and the file
    // descriptor belongs to this live Unix stream. Linux SO_PEERCRED writes a
    // `struct ucred` of the same pid/uid/gid layout represented above.
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

    let deadline = Instant::now() + COMMAND_TIMEOUT;
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
struct Request {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

fn read_request(stream: &mut UnixStream) -> Result<Request, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|_| "cannot set request timeout".to_owned())?;
    let mut bytes = Vec::with_capacity(4096);
    let mut buffer = [0_u8; 2048];
    loop {
        let read = stream
            .read(&mut buffer)
            .map_err(|_| "cannot read HTTP request".to_owned())?;
        if read == 0 {
            return Err("truncated HTTP request".to_owned());
        }
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.len() > MAX_HTTP_HEADERS {
            return Err("HTTP headers too large".to_owned());
        }
        if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| "non-UTF-8 HTTP headers".to_owned())?;
    let header_end = text
        .find("\r\n\r\n")
        .ok_or_else(|| "incomplete HTTP headers".to_owned())?;
    let mut lines = text[..header_end].split("\r\n");
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
    Ok(Request {
        method,
        path,
        headers,
    })
}

fn send_json(stream: &mut UnixStream, status: u16, body: &str) {
    let reason = match status {
        200 => "OK",
        403 => "Forbidden",
        404 => "Not Found",
        _ => "Error",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn reject(stream: &mut UnixStream) {
    send_json(stream, 403, r#"{"error":"untrusted origin identity"}"#);
}

fn handle_connection(mut stream: UnixStream, config: &Config) {
    let Ok((uid, gid)) = peer_credentials(&stream) else {
        reject(&mut stream);
        return;
    };
    if uid != config.expected_uid || gid != config.expected_gid {
        reject(&mut stream);
        return;
    }

    let Ok(request) = read_request(&mut stream) else {
        reject(&mut stream);
        return;
    };
    if request.method != "GET" || request.path != "/identity-probe" {
        send_json(&mut stream, 404, r#"{"error":"not found"}"#);
        return;
    }
    if request.header("X-XSP-V2-Client-Verify") != Some("SUCCESS") {
        reject(&mut stream);
        return;
    }
    let Some(escaped_cert) = request.header("X-XSP-V2-Client-Cert") else {
        reject(&mut stream);
        return;
    };
    if escaped_cert.is_empty() || escaped_cert.len() > MAX_CERT_HEADER {
        reject(&mut stream);
        return;
    }
    let fingerprint = match spki_sha256(&percent_decode(escaped_cert)) {
        Ok(value) => value,
        Err(_) => {
            reject(&mut stream);
            return;
        }
    };
    if fingerprint != config.expected_spki {
        reject(&mut stream);
        return;
    }
    let body = format!(
        r#"{{"clientSpkiSha256":"{}","originTransport":"unix-peercred","trustedNodeId":{}}}"#,
        fingerprint, config.expected_node_id
    );
    send_json(&mut stream, 200, &body);
}

fn bind_listener(path: &Path) -> Result<UnixListener, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create socket directory: {error}"))?;
    }
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("cannot remove stale origin socket: {error}")),
    }

    // SAFETY: process umask is changed only around the synchronous bind and is
    // restored immediately afterwards. The resulting socket is chmod'd to the
    // exact 0660 contract before any requests are accepted.
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
    let config = Config::from_env()?;
    let listener = bind_listener(&config.socket_path)?;
    for connection in listener.incoming() {
        match connection {
            Ok(stream) => handle_connection(stream, &config),
            Err(error) => eprintln!("xsp-origin-probe: accept failed: {error}"),
        }
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("xsp-origin-probe: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::{hex_value, percent_decode, to_hex};

    #[test]
    fn percent_decode_matches_nginx_escaped_certificate_shape() {
        assert_eq!(percent_decode("A%20B%0AC"), b"A B\nC");
        assert_eq!(percent_decode("%ZZ%2"), b"%ZZ%2");
    }

    #[test]
    fn lowercase_hex_encoding_is_canonical() {
        assert_eq!(to_hex(&[0, 1, 15, 16, 255]), "00010f10ff");
        assert_eq!(hex_value(b'F'), Some(15));
        assert_eq!(hex_value(b'g'), None);
    }
}
