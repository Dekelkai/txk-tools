import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// --- 数据结构定义 ---
interface CondaInfo { conda_version: string; python_version: string; root_prefix: string; }
interface Environment { path: string; python_version: string; }
interface Package { name: string; version: string; build: string; channel: string; }

function App() {
  // --- 状态管理 ---
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [condaInfo, setCondaInfo] = useState<CondaInfo | null>(null);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedEnvPath, setSelectedEnvPath] = useState<string | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const subscribed = useRef(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // --- 效果与监听 ---
  useEffect(() => { if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight; }, [logs]);

  useEffect(() => {
    if (subscribed.current) return;
    subscribed.current = true;
    const setupListeners = async () => {
      const unlistenStdout = await listen<any>("backend://stdout", (event) => {
        const line = event.payload;
        try {
          const result = JSON.parse(line);
          if (result.command === 'probe') { if (result.ok) setCondaInfo(result.data); else setError(result.error); } 
          else if (result.command === 'env-list') { if (result.ok) setEnvironments(result.data); else setError(result.error); } 
          else if (result.command === 'pkg-list') { if (result.ok) setPackages(result.data); else { setError(result.error); setPackages([]); } }
          else if (result.command === 'env-create') { // 处理创建成功事件
            if (result.ok) {
              setLogs(prev => [...prev, "--- Environment created successfully! Refreshing list... ---"]);
              runCommand('env-list'); // 创建成功后自动刷新环境列表
            } else { setError(result.error); }
          }
        } catch (e) { setLogs((prev) => [...prev, line]); }
      });
      const unlistenStderr = await listen<string>("backend://stderr", (event) => setLogs((prev) => [...prev, `[ERR] ${event.payload}`]));
      const unlistenTerminated = await listen<string>("backend://terminated", (event) => {
        setRunning(null);
      });
      return () => { unlistenStdout(); unlistenStderr(); unlistenTerminated(); };
    };
    const unlistenPromise = setupListeners();
    return () => { unlistenPromise.then(cleanup => cleanup && cleanup()); };
  }, []); // 移除 running 依赖，因为回调内的 runCommand 不需要是最新的

  // --- 命令执行与处理 ---
  const runCommand = async (command: string, extraArgs: string[] = []) => {
    if (running) return;
    const commandWithArgs = [command, ...extraArgs].join(' ');
    setRunning(commandWithArgs);
    setLogs(prev => [...prev, `\n--- Starting command: ${commandWithArgs} ---`]);
    setError(null);
    try { await invoke("run_python_dev", { args: [command, ...extraArgs] }); }
    catch (e: any) { setError(String(e)); setRunning(null); }
  };

  const handleEnvSelect = (env: Environment) => {
    if (running) return;
    setSelectedEnvPath(env.path);
    setPackages([]); setSearchQuery("");
    runCommand('pkg-list', ['--prefix', env.path]);
  };

  const handleCreateEnv = () => {
    // 使用原生的 prompt，简单快速。后续可以替换为漂亮的模态框。
    const name = prompt("请输入新环境的名称:", "my-new-env");
    if (!name) return;
    const pythonVersion = prompt("请输入 Python 版本 (例如 3.9):", "3.9");
    if (!pythonVersion) return;
    runCommand('env-create', ['--name', name, '--python', pythonVersion]);
  };

  const filteredPackages = useMemo(() => {
    if (!searchQuery) return packages;
    return packages.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [packages, searchQuery]);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif", display: 'flex', gap: '24px' }}>
      {/* 左侧区域 */}
      <div style={{ flex: 1 }}>
        <h1>TXK-Tools</h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
          <button onClick={() => runCommand('probe')} disabled={!!running}>探测 Conda</button>
          <button onClick={() => runCommand('env-list')} disabled={!!running}>加载环境</button>
          <button onClick={() => setLogs([])} disabled={logs.length === 0}>清空日志</button>
        </div>
        {error && <div style={{ padding: 8, background: "#fff1f0", border: "1px solid #ffa39e", marginBottom: '12px' }}><strong>操作失败:</strong> {error}</div>}
        {condaInfo && <div style={{ padding: 8, background: "#e6ffed", border: "1px solid #b7eb8f", marginBottom: '12px' }}><strong>Conda 已就绪</strong> (版本: {condaInfo.conda_version})</div>}
        <h3>日志输出</h3>
        <div ref={logContainerRef} style={{ border: "1px solid #ccc", height: 400, overflow: "auto", padding: 12, background: "#fafafa", fontFamily: "monospace" }}>
          {logs.length === 0 ? <em>点击按钮开始...</em> : logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
      {/* 右侧区域 */}
      <div style={{ width: '500px', borderLeft: '1px solid #eee', paddingLeft: '24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>环境列表</h2>
          <button onClick={handleCreateEnv} disabled={!!running}>创建环境</button>
        </div>
        <div style={{ border: '1px solid #ccc', height: '200px', overflowY: 'auto', marginBottom: '16px' }}>
          {running?.startsWith('env-list') ? <p style={{padding: '8px'}}>加载中...</p> : 
          environments.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {environments.map((env) => {
                const envName = env.path.split(/[\\/]/).pop() || env.path;
                const isBase = env.path === condaInfo?.root_prefix;
                const isSelected = env.path === selectedEnvPath;
                return (
                  <li key={env.path} onClick={() => handleEnvSelect(env)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', background: isSelected ? '#e6f7ff' : 'transparent' }}>
                    <span style={{ fontWeight: isBase ? 'bold' : 'normal' }}>{envName} {isBase && '(base)'}</span>
                    <span style={{ fontSize: '0.9em', color: '#666', background: '#eee', padding: '2px 6px', borderRadius: '4px' }}>{env.python_version}</span>
                  </li>
                );
              })}
            </ul>
          ) : <p style={{ padding: '8px' }}>请点击“加载环境”</p>}
        </div>
        <h2>包列表 {selectedEnvPath && `(in ${selectedEnvPath.split(/[\\/]/).pop()})`}</h2>
        <input type="search" placeholder="搜索包名..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box' }} />
        <div style={{ flex: 1, border: '1px solid #ccc', overflowY: 'auto' }}>
          {selectedEnvPath ? (
            running?.startsWith('pkg-list') ? <p style={{padding: '8px'}}>加载中...</p> :
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#fafafa' }}>
                <tr><th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>名称</th><th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>版本</th></tr>
              </thead>
              <tbody>
                {filteredPackages.map((pkg, i) => (<tr key={`${pkg.name}-${i}`}><td style={{ padding: '8px', borderBottom: '1px solid #f0f0f0' }}>{pkg.name}</td><td style={{ padding: '8px', borderBottom: '1px solid #f0f0f0' }}>{pkg.version}</td></tr>))}
              </tbody>
            </table>
          ) : <p style={{ padding: '8px' }}>请从上方选择一个环境</p>}
        </div>
      </div>
    </div>
  );
}

export default App;