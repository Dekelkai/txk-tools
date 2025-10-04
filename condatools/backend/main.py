#!/usr/bin/env python3
import sys  # 导入 sys 模块，用于与 Python 解释器交互
import time  # 导入 time 模块，用于延时操作
import json  # 导入 json 模块，用于处理 JSON 数据
import argparse  # 导入 argparse 模块，用于解析命令行参数
import shutil  # 导入 shutil 模块，用于文件操作（例如查找可执行文件）
import subprocess  # 导入 subprocess 模块，用于运行子进程（未使用）

def log(line: str, stream="stdout"):  # 定义日志函数，支持输出到 stdout 或 stderr
    # 简单行式日志，前端按行显示
    print(line, flush=True, file=sys.stdout if stream == "stdout" else sys.stderr)  # 根据 stream 参数选择输出目标

def cmd_probe(args):  # 定义 "probe" 子命令的处理函数
    log("Starting probe...")  # 输出日志，表示开始探测
    time.sleep(0.3)  # 模拟延时，模拟探测过程
    # 示例：检查系统是否能找到 conda 可执行（真实实现放到 M2）
    conda_path = shutil.which("conda")  # 使用 shutil.which 查找 conda 可执行文件的路径
    if conda_path:  # 如果找到了 conda
        log(f"Found conda at: {conda_path}")  # 输出 conda 的路径
        status = {"ok": True, "conda_path": conda_path}  # 构造成功状态的 JSON 数据
    else:  # 如果未找到 conda
        log("Conda not found in PATH", stream="stderr")  # 输出错误日志
        status = {"ok": False, "conda_path": None}  # 构造失败状态的 JSON 数据
    # 用一行 JSON 作为“结果”，便于前端解析
    print(json.dumps(status), flush=True)  # 将状态数据序列化为 JSON 并输出

def main():  # 定义主函数
    parser = argparse.ArgumentParser(prog="conda-backend")  # 创建 ArgumentParser 对象，设置程序名称
    sub = parser.add_subparsers(dest="command")  # 添加子命令解析器

    sub_probe = sub.add_parser("probe", help="probe conda availability")  # 添加 "probe" 子命令
    sub_probe.set_defaults(func=cmd_probe)  # 将 "probe" 子命令与 cmd_probe 函数绑定

    ns = parser.parse_args()  # 解析命令行参数
    if not ns.command:  # 如果未提供子命令
        parser.print_help()  # 打印帮助信息
        sys.exit(2)  # 退出程序，返回状态码 2
    ns.func(ns)  # 调用与子命令绑定的函数

if __name__ == "__main__":  # 如果当前脚本是主程序
    main()  # 调用主函数