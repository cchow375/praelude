//! Small, audited desktop-OS seams.
//!
//! Every command here has a fixed executable and fixed control arguments. URLs
//! are passed as one argument only after an HTTPS/control-character gate; paths
//! come from an already-validated app record or a native picker. No user text is
//! ever interpolated into a shell program.

use std::path::Path;
#[cfg(target_os = "windows")]
use std::path::PathBuf;

const MAX_EXTERNAL_URL_LEN: usize = 8 * 1024;

fn validated_https_url(url: &str) -> Result<&str, String> {
    if url.is_empty()
        || url.len() > MAX_EXTERNAL_URL_LEN
        || url.chars().any(char::is_control)
        || !url.starts_with("https://")
        || url["https://".len()..]
            .split(['/', '?', '#'])
            .next()
            .is_none_or(str::is_empty)
    {
        return Err("Only a valid https link can be opened.".into());
    }
    Ok(url)
}

pub fn open_https(url: &str) -> Result<(), String> {
    let url = validated_https_url(url)?;
    open_https_platform(url)
}

#[cfg(target_os = "macos")]
fn open_https_platform(url: &str) -> Result<(), String> {
    command_succeeded(
        std::process::Command::new("/usr/bin/open")
            .arg(url)
            .status(),
        "Could not open the link in your browser.",
    )
}

#[cfg(target_os = "windows")]
fn open_https_platform(url: &str) -> Result<(), String> {
    let executable = windows_system32("rundll32.exe")?;
    command_succeeded(
        std::process::Command::new(executable)
            .args(["url.dll,FileProtocolHandler", url])
            .status(),
        "Could not open the link in your browser.",
    )
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn open_https_platform(url: &str) -> Result<(), String> {
    command_succeeded(
        std::process::Command::new("xdg-open").arg(url).status(),
        "Could not open the link in your browser.",
    )
}

fn command_succeeded(
    status: std::io::Result<std::process::ExitStatus>,
    message: &str,
) -> Result<(), String> {
    match status {
        Ok(status) if status.success() => Ok(()),
        _ => Err(message.to_string()),
    }
}

pub fn pick_pdf_file() -> Result<Option<String>, String> {
    pick_pdf_file_platform()
}

#[cfg(target_os = "macos")]
fn pick_pdf_file_platform() -> Result<Option<String>, String> {
    let output = std::process::Command::new("/usr/bin/osascript")
        .args([
            "-e",
            "POSIX path of (choose file with prompt \"Choose a PDF score\" of type {\"com.adobe.pdf\"})",
        ])
        .output()
        .map_err(|_| "Could not open the file picker.".to_string())?;
    // AppleScript uses -128 for Cancel. Preserve the established cancel contract.
    if !output.status.success() {
        return Ok(None);
    }
    selected_path(&output.stdout)
}

#[cfg(target_os = "windows")]
fn pick_pdf_file_platform() -> Result<Option<String>, String> {
    const PICK_PDF: &str = r#"[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.OpenFileDialog; $dialog.Title = 'Choose a PDF score'; $dialog.Filter = 'PDF scores (*.pdf)|*.pdf'; $dialog.Multiselect = $false; $dialog.CheckFileExists = $true; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }"#;
    let executable = windows_powershell()?;
    let output = std::process::Command::new(executable)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-STA",
            "-Command",
            PICK_PDF,
        ])
        .output()
        .map_err(|_| "Could not open the file picker.".to_string())?;
    if !output.status.success() {
        return Err("The Windows file picker could not be opened.".into());
    }
    selected_path(&output.stdout)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn pick_pdf_file_platform() -> Result<Option<String>, String> {
    Err("A native PDF picker is unavailable on this platform.".into())
}

fn selected_path(stdout: &[u8]) -> Result<Option<String>, String> {
    let path = String::from_utf8(stdout.to_vec())
        .map_err(|_| "The file picker returned an invalid path.".to_string())?;
    let path = path.trim();
    if path.is_empty() {
        Ok(None)
    } else if path.chars().any(char::is_control) {
        Err("The file picker returned an invalid path.".into())
    } else {
        Ok(Some(path.to_string()))
    }
}

pub fn reveal_file(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("The file location is invalid.".into());
    }
    reveal_file_platform(path)
}

#[cfg(target_os = "macos")]
fn reveal_file_platform(path: &Path) -> Result<(), String> {
    command_succeeded(
        std::process::Command::new("/usr/bin/open")
            .arg("-R")
            .arg(path)
            .status(),
        "Could not reveal the tutorial video.",
    )
}

#[cfg(target_os = "windows")]
fn reveal_file_platform(path: &Path) -> Result<(), String> {
    use std::ffi::OsString;

    let executable = windows_system32("explorer.exe")?;
    let mut selection = OsString::from("/select,");
    selection.push(path.as_os_str());
    std::process::Command::new(executable)
        .arg(selection)
        .spawn()
        .map(|_| ())
        .map_err(|_| "Could not reveal the tutorial video.".to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn reveal_file_platform(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The file location is invalid.".to_string())?;
    command_succeeded(
        std::process::Command::new("xdg-open").arg(parent).status(),
        "Could not reveal the tutorial video.",
    )
}

#[cfg(target_os = "windows")]
fn windows_system32(executable: &str) -> Result<PathBuf, String> {
    let root = std::env::var_os("SystemRoot")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "The Windows system directory is unavailable.".to_string())?;
    Ok(PathBuf::from(root).join("System32").join(executable))
}

#[cfg(target_os = "windows")]
fn windows_powershell() -> Result<PathBuf, String> {
    Ok(windows_system32("WindowsPowerShell")?
        .join("v1.0")
        .join("powershell.exe"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_gate_rejects_non_https_empty_hosts_controls_and_oversize() {
        assert_eq!(
            validated_https_url("https://imslp.org/a?b=1"),
            Ok("https://imslp.org/a?b=1")
        );
        for invalid in [
            "",
            "http://imslp.org",
            "https://",
            "https:///path",
            "https://ok.example/\nnext",
        ] {
            assert!(
                validated_https_url(invalid).is_err(),
                "accepted {invalid:?}"
            );
        }
        assert!(validated_https_url(&format!(
            "https://example.com/{}",
            "x".repeat(MAX_EXTERNAL_URL_LEN)
        ))
        .is_err());
    }

    #[test]
    fn selected_path_distinguishes_cancel_from_a_real_path() {
        assert_eq!(selected_path(b"  \n").unwrap(), None);
        assert_eq!(
            selected_path(b"C:\\Users\\Friend\\score.pdf\r\n").unwrap(),
            Some(r"C:\Users\Friend\score.pdf".into())
        );
        assert_eq!(
            selected_path("C:\\Users\\Friend\\Frédéric Chopin.pdf\r\n".as_bytes()).unwrap(),
            Some(r"C:\Users\Friend\Frédéric Chopin.pdf".into())
        );
        assert!(selected_path(b"C:\\bad\nname.pdf").is_err());
    }
}
