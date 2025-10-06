#!/usr/bin/env python3
import sys
import json
import argparse
import shutil
import subprocess

def log(line: str, stream="stdout"):
    """向前端发送单行日志。"""
    print(line, flush=True, file=sys.stdout if stream == "stdout" else sys.stderr)

def emit_result(command: str, data: dict):
    """向前端发送最终的 JSON 结果。"""
    result = {"command": command, **data}
    print(json.dumps(result), flush=True)

def get_conda_path():
    """查找 conda 可执行文件路径。"""
    return shutil.which("conda")

def run_conda_command_for_json(args: list, command_name: str):
    """一个通用的 conda 命令执行器，用于返回 JSON 的命令。"""
    conda_path = get_conda_path()
    if not conda_path:
        emit_result(command_name, {"ok": False, "error": "Conda not found in PATH"})
        return False, None

    full_command = [conda_path] + args
    log(f"Executing: {' '.join(full_command)}")
    try:
        # 对于需要实时日志的长时间命令，我们不能用 subprocess.run
        # 但对于快速返回 JSON 的命令，这个方法很好
        proc = subprocess.run(full_command, capture_output=True, text=True, check=True, encoding='utf-8')
        return True, json.loads(proc.stdout)
    except Exception as e:
        error_message = str(e)
        if isinstance(e, subprocess.CalledProcessError):
            error_message = e.stderr.strip() or e.stdout.strip()
        log(f"Error during '{command_name}': {error_message}", stream="stderr")
        emit_result(command_name, {"ok": False, "error": error_message})
        return False, None

def stream_conda_command(args: list, command_name: str):
    """用于执行长时间运行的命令，并实时流式传输日志。"""
    conda_path = get_conda_path()
    if not conda_path:
        emit_result(command_name, {"ok": False, "error": "Conda not found in PATH"})
        return

    full_command = [conda_path] + args
    log(f"Executing: {' '.join(full_command)}")
    try:
        # 使用 Popen 来创建子进程，以便我们可以实时读取输出
        process = subprocess.Popen(full_command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', bufsize=1)
        
        # 实时读取每一行输出并发送到前端
        for line in iter(process.stdout.readline, ''):
            log(line.strip())
        
        process.wait() # 等待命令执行完成
        
        if process.returncode == 0:
            log(f"'{command_name}' successful.")
            emit_result(command_name, {"ok": True})
        else:
            log(f"'{command_name}' failed with exit code {process.returncode}.", stream="stderr")
            emit_result(command_name, {"ok": False, "error": f"Process failed with exit code {process.returncode}."})

    except Exception as e:
        log(f"An unexpected error occurred during '{command_name}': {e}", stream="stderr")
        emit_result(command_name, {"ok": False, "error": str(e)})

def cmd_probe(args):
    success, data = run_conda_command_for_json(["info", "--json"], "probe")
    if success: emit_result("probe", {"ok": True, "data": data})

def cmd_env_list(args):
    # ... (这个函数保持不变) ...
    success, data = run_conda_command_for_json(["env", "list", "--json"], "env-list")
    if not success: return
    conda_path = get_conda_path()
    env_paths = data.get("envs", [])
    enriched_envs = []
    for i, env_path in enumerate(env_paths):
        log(f"Probing Python version for env {i+1}/{len(env_paths)}: {env_path}")
        python_version = "N/A"
        try:
            py_version_cmd = [conda_path, "run", "--prefix", env_path, "python", "--version"]
            py_version_proc = subprocess.run(py_version_cmd, capture_output=True, text=True, timeout=5, encoding='utf-8')
            output = py_version_proc.stdout.strip() or py_version_proc.stderr.strip()
            if "Python" in output: python_version = output.split()[-1]
        except Exception: pass
        enriched_envs.append({"path": env_path, "python_version": python_version})
    log("'env-list' successful.")
    emit_result("env-list", {"ok": True, "data": enriched_envs})


def cmd_pkg_list(args):
    success, data = run_conda_command_for_json(["list", "--prefix", args.prefix, "--json"], "pkg-list")
    if success: emit_result("pkg-list", {"ok": True, "data": data})

def cmd_env_create(args):
    """创建一个新的 Conda 环境。"""
    create_args = ["create", "--name", args.name, f"python={args.python}", "--yes"]
    stream_conda_command(create_args, "env-create")

def main():
    parser = argparse.ArgumentParser(prog="txk-backend")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("probe", help="Probe conda availability").set_defaults(func=cmd_probe)
    sub.add_parser("env-list", help="List all conda environments").set_defaults(func=cmd_env_list)
    
    pkg_parser = sub.add_parser("pkg-list", help="List packages in an environment")
    pkg_parser.add_argument("--prefix", required=True, help="Path to the conda environment")
    pkg_parser.set_defaults(func=cmd_pkg_list)

    # 新增 env-create 命令
    create_parser = sub.add_parser("env-create", help="Create a new conda environment")
    create_parser.add_argument("--name", required=True, help="Name of the new environment")
    create_parser.add_argument("--python", required=True, help="Python version for the new environment")
    create_parser.set_defaults(func=cmd_env_create)

    ns = parser.parse_args()
    ns.func(ns)

if __name__ == "__main__":
    main()