#!/usr/bin/env python3
import sys
import json
import argparse
import shutil
import subprocess
import threading
import os
import re

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
    try:
        proc = subprocess.run(full_command, capture_output=True, text=True, check=True, encoding='utf-8', timeout=30)
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
    success, data = run_conda_command_for_json(["env", "list", "--json"], "env-list")
    if not success: return
    env_paths = data.get("envs", [])
    enriched_envs = [None] * len(env_paths)
    threads = []
    def _probe_python_version(env_path, index):
        python_version = "N/A"
        try:
            python_exe = os.path.join(env_path, "python.exe") if sys.platform == "win32" else os.path.join(env_path, "bin", "python")
            if not os.path.exists(python_exe): raise FileNotFoundError("python executable not found")
            py_version_proc = subprocess.run([python_exe, "--version"], capture_output=True, text=True, timeout=5, encoding='utf-8', check=True)
            output = py_version_proc.stdout.strip() or py_version_proc.stderr.strip()
            if "Python" in output: python_version = output.split()[-1]
        except Exception as e:
            log(f"Could not get Python version for '{os.path.basename(env_path)}': {e}", stream="stderr")
        enriched_envs[index] = {"path": env_path, "python_version": python_version}
    for i, env_path in enumerate(env_paths):
        thread = threading.Thread(target=_probe_python_version, args=(env_path, i)); threads.append(thread); thread.start()
    for thread in threads: thread.join()
    log("'env-list' (with Python versions) successful.")
    emit_result("env-list", {"ok": True, "data": enriched_envs})

def cmd_pkg_list(args):
    success, data = run_conda_command_for_json(["list", "--prefix", args.prefix, "--json"], "pkg-list")
    if success: emit_result("pkg-list", {"ok": True, "data": data})

def cmd_env_create(args):
    stream_conda_command(["create", "--name", args.name, f"python={args.python}", "--yes"], "env-create")

def cmd_env_remove(args):
    stream_conda_command(["env", "remove", "--prefix", args.prefix, "--yes"], "env-remove")

def cmd_env_rename(args):
    clone_success = stream_conda_command(["create", "--name", args.new_name, "--clone", args.old_name, "--yes"], "env-rename", emit_final_result=False)
    if not clone_success:
        emit_result("env-rename", {"ok": False, "error": "Cloning step failed."}); return
    remove_success = stream_conda_command(["env", "remove", "--name", args.old_name, "--yes"], "env-rename", emit_final_result=False)
    if not remove_success:
        emit_result("env-rename", {"ok": False, "error": "Clone succeeded, but remove step failed."}); return
    emit_result("env-rename", {"ok": True})

def cmd_env_export(args):
    try:
        conda_path = get_conda_path()
        if not conda_path: raise Exception("Conda not found in PATH")
        cmd = [conda_path]; output = ""
        if args.format == "yml":
            export_cmd = ["env", "export", "--name", args.name]
            if args.no_builds: export_cmd.append("--no-builds")
            cmd.extend(export_cmd)
            proc = subprocess.run(cmd, capture_output=True, text=True, check=True, encoding='utf-8')
            lines = proc.stdout.splitlines()
            cleaned_lines = [line for line in lines if not line.startswith('prefix:')]
            output = "\n".join(cleaned_lines)
        elif args.format == "txt":
            export_cmd = ["list", "--export", "--name", args.name]
            cmd.extend(export_cmd)
            proc = subprocess.run(cmd, capture_output=True, text=True, check=True, encoding='utf-8')
            output = proc.stdout
            if args.no_builds:
                lines = output.splitlines()
                processed_lines = [re.sub(r'=[^=]*$', '', line) for line in lines if not line.startswith('#')]
                output = "\n".join(processed_lines)
        with open(args.file, 'w', encoding='utf-8') as f: f.write(output)
        emit_result("env-export", {"ok": True})
    except Exception as e:
        error_message = str(e)
        if isinstance(e, subprocess.CalledProcessError): error_message = e.stderr.strip() or e.stdout.strip()
        emit_result("env-export", {"ok": False, "error": error_message})

def cmd_env_import(args):
    stream_conda_command(["env", "create", "--file", args.file, "--name", args.name, "--yes"], "env-import")

def cmd_env_clone(args):
    stream_conda_command(["create", "--name", args.dest_name, "--clone", args.source_name, "--yes"], "env-clone")

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
    
    export_parser = sub.add_parser("env-export", help="Export a conda environment to a file")
    export_parser.add_argument("--name", required=True)
    export_parser.add_argument("--file", required=True)
    export_parser.add_argument("--format", required=True, choices=['yml', 'txt'])
    export_parser.add_argument("--no-builds", action='store_true')
    export_parser.set_defaults(func=cmd_env_export)
    
    import_parser = sub.add_parser("env-import", help="Import a conda environment from a file")
    import_parser.add_argument("--file", required=True)
    import_parser.add_argument("--name", required=True)
    import_parser.set_defaults(func=cmd_env_import)
    
    clone_parser = sub.add_parser("env-clone", help="Clone an existing conda environment")
    clone_parser.add_argument("--source-name", required=True)
    clone_parser.add_argument("--dest-name", required=True)
    clone_parser.set_defaults(func=cmd_env_clone)
    
    ns = parser.parse_args()
    ns.func(ns)

if __name__ == "__main__":
    main()