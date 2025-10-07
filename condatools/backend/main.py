#!/usr/bin/env python3
import sys
import json
import argparse
import shutil
import subprocess
import threading
import os

# ... (log, emit_result, get_conda_path, run_conda_command_for_json, stream_conda_command, cmd_probe 函数保持不变) ...
def log(line: str, stream="stdout"):
    print(line, flush=True, file=sys.stdout if stream == "stdout" else sys.stderr)

def emit_result(command: str, data: dict):
    result = {"command": command, **data}
    print(json.dumps(result), flush=True)

def get_conda_path():
    return shutil.which("conda")

def run_conda_command_for_json(args: list, command_name: str):
    conda_path = get_conda_path()
    if not conda_path:
        emit_result(command_name, {"ok": False, "error": "Conda not found in PATH"})
        return False, None
    full_command = [conda_path] + args
    log(f"Executing: {' '.join(full_command)}")
    try:
        proc = subprocess.run(full_command, capture_output=True, text=True, check=True, encoding='utf-8', timeout=10)
        return True, json.loads(proc.stdout)
    except Exception as e:
        error_message = str(e)
        if isinstance(e, subprocess.CalledProcessError):
            error_message = e.stderr.strip() or e.stdout.strip()
        log(f"Error during '{command_name}': {error_message}", stream="stderr")
        emit_result(command_name, {"ok": False, "error": error_message})
        return False, None

def stream_conda_command(args: list, command_name: str, emit_final_result=True) -> bool:
    conda_path = get_conda_path()
    if not conda_path:
        if emit_final_result: emit_result(command_name, {"ok": False, "error": "Conda not found in PATH"})
        return False
    full_command = [conda_path] + args
    log(f"Executing: {' '.join(full_command)}")
    try:
        process = subprocess.Popen(full_command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', bufsize=1)
        for line in iter(process.stdout.readline, ''):
            log(line.strip())
        process.wait()
        if process.returncode == 0:
            log(f"Sub-command '{' '.join(args)}' successful.")
            if emit_final_result: emit_result(command_name, {"ok": True})
            return True
        else:
            log(f"Sub-command '{' '.join(args)}' failed with exit code {process.returncode}.", stream="stderr")
            if emit_final_result: emit_result(command_name, {"ok": False, "error": f"Process failed with exit code {process.returncode}."})
            return False
    except Exception as e:
        log(f"An unexpected error occurred: {e}", stream="stderr")
        if emit_final_result: emit_result(command_name, {"ok": False, "error": str(e)})
        return False

def cmd_probe(args):
    success, data = run_conda_command_for_json(["info", "--json"], "probe")
    if success: emit_result("probe", {"ok": True, "data": data})

def cmd_env_list(args):
    """
    列出所有 Conda 环境，并使用多线程并行、直接调用 Python 的方式获取版本。
    """
    success, data = run_conda_command_for_json(["env", "list", "--json"], "env-list")
    if not success:
        return

    env_paths = data.get("envs", [])
    enriched_envs = [None] * len(env_paths)
    threads = []

    def _probe_python_version(env_path, index):
        python_version = "N/A"
        try:
            # 修正：直接构造 Python 可执行文件的路径
            if sys.platform == "win32":
                python_exe = os.path.join(env_path, "python.exe")
            else:
                python_exe = os.path.join(env_path, "bin", "python")

            # 检查 python.exe 是否存在
            if not os.path.exists(python_exe):
                raise FileNotFoundError("python executable not found in this env")

            # 直接执行 python.exe --version
            py_version_proc = subprocess.run(
                [python_exe, "--version"],
                capture_output=True,
                text=True,
                timeout=5,
                encoding='utf-8',
                check=True
            )
            output = py_version_proc.stdout.strip() or py_version_proc.stderr.strip()
            if "Python" in output:
                python_version = output.split()[-1]
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as e:
            # 将所有可能的错误都归为“无法获取版本”
            log(f"Could not get Python version for '{os.path.basename(env_path)}': {e}", stream="stderr")
        
        enriched_envs[index] = {"path": env_path, "python_version": python_version}

    log(f"Starting to probe Python versions for {len(env_paths)} environments in parallel...")

    for i, env_path in enumerate(env_paths):
        thread = threading.Thread(target=_probe_python_version, args=(env_path, i))
        threads.append(thread)
        thread.start()

    for thread in threads:
        thread.join()

    log("'env-list' (with Python versions) successful.")
    emit_result("env-list", {"ok": True, "data": enriched_envs})

# ... (其余函数 cmd_pkg_list, cmd_env_create 等保持不变) ...
def cmd_pkg_list(args):
    success, data = run_conda_command_for_json(["list", "--prefix", args.prefix, "--json"], "pkg-list")
    if success: emit_result("pkg-list", {"ok": True, "data": data})

def cmd_env_create(args):
    stream_conda_command(["create", "--name", args.name, f"python={args.python}", "--yes"], "env-create")

def cmd_env_remove(args):
    stream_conda_command(["env", "remove", "--prefix", args.prefix, "--yes"], "env-remove")

def cmd_env_rename(args):
    log("--- Step 1/2: Cloning environment ---")
    clone_args = ["create", "--name", args.new_name, "--clone", args.old_name, "--yes"]
    clone_success = stream_conda_command(clone_args, "env-rename", emit_final_result=False)
    if not clone_success:
        log("Cloning failed. Aborting rename operation.", stream="stderr")
        emit_result("env-rename", {"ok": False, "error": "Cloning step failed."})
        return
    log("--- Step 2/2: Removing old environment ---")
    remove_args = ["env", "remove", "--name", args.old_name, "--yes"]
    remove_success = stream_conda_command(remove_args, "env-rename", emit_final_result=False)
    if not remove_success:
        log("Cloning succeeded, but removing the old environment failed. Please remove it manually.", stream="stderr")
        emit_result("env-rename", {"ok": False, "error": "Clone succeeded, but remove step failed."})
        return
    log("Rename operation completed successfully.")
    emit_result("env-rename", {"ok": True})

def main():
    parser = argparse.ArgumentParser(prog="txk-backend")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("probe", help="Probe conda availability").set_defaults(func=cmd_probe)
    sub.add_parser("env-list", help="List all conda environments").set_defaults(func=cmd_env_list)
    pkg_parser = sub.add_parser("pkg-list", help="List packages in an environment")
    pkg_parser.add_argument("--prefix", required=True)
    pkg_parser.set_defaults(func=cmd_pkg_list)
    create_parser = sub.add_parser("env-create", help="Create a new conda environment")
    create_parser.add_argument("--name", required=True)
    create_parser.add_argument("--python", required=True)
    create_parser.set_defaults(func=cmd_env_create)
    remove_parser = sub.add_parser("env-remove", help="Remove a conda environment")
    remove_parser.add_argument("--prefix", required=True)
    remove_parser.set_defaults(func=cmd_env_remove)
    rename_parser = sub.add_parser("env-rename", help="Rename a conda environment")
    rename_parser.add_argument("--old-name", required=True)
    rename_parser.add_argument("--new-name", required=True)
    rename_parser.set_defaults(func=cmd_env_rename)
    ns = parser.parse_args()
    ns.func(ns)

if __name__ == "__main__":
    main()