// 在 Windows 发布版本中防止弹出额外的控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Window, Emitter};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use std::thread;

#[tauri::command]
fn run_python_dev(window: Window, args: Vec<String>) -> Result<(), String> {
    // 用 CARGO_MANIFEST_DIR（指向 src-tauri）定位到项目根的 backend/main.py
    let script_path: PathBuf = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../backend/main.py")
        .canonicalize()
        .map_err(|_| "Python script not found: ../backend/main.py (from src-tauri)".to_string())?;

    if !script_path.exists() {
        return Err(format!("Python script not found: {:?}", script_path));
    }

    let mut full_args = vec![script_path.to_string_lossy().to_string()];
    full_args.extend(args);

    // 使用 script_path 所在目录作为 cwd
    let cwd = script_path
        .parent()
        .ok_or("Failed to get parent directory of script")?;

    let mut child = Command::new("python")
        .args(full_args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn python failed: {e}"))?;

    // stdout
    if let Some(stdout) = child.stdout.take() {
        let window_clone = window.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let _ = window_clone.emit("backend://stdout", line);
                }
            }
        });
    }

    // stderr
    if let Some(stderr) = child.stderr.take() {
        let window_clone = window.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let _ = window_clone.emit("backend://stderr", line);
                }
            }
        });
    }

    // 等待子进程结束，发出 terminated 事件
    let window_clone = window.clone();
    thread::spawn(move || {
        let status = child.wait().ok().and_then(|s| s.code());
        let code_str = status.map(|c| c.to_string()).unwrap_or_else(|| "unknown".into());
        let _ = window_clone.emit("backend://terminated", code_str);
    });

    Ok(())
}

// 应用入口
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![run_python_dev])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
