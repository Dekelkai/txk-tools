import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";

// --- 数据结构定义 (保持不变) ---
interface CondaInfo { conda_version: string; python_version: string; root_prefix: string; }
interface Environment { path: string; python_version: string; }
interface Package { name: string; version: string; build: string; channel: string; }

function App() {
  // --- 状态管理 (保持不变) ---
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

  // 主要的事件监听器，只在组件挂载时运行一次
  useEffect(() => {
    if (subscribed.current) return;
    subscribed.current = true;
    const setupListeners = async () => {
      const unlistenStdout = await listen<any>("backend://stdout", (event) => {
        const line = event.payload;
        try {
          const result = JSON.parse(line);
          const cmd = result.command;
          if (cmd === 'probe') { if (result.ok) setCondaInfo(result.data); else setError(result.error); } 
          else if (cmd === 'env-list') { if (result.ok) setEnvironments(result.data); else setError(result.error); } 
          else if (cmd === 'pkg-list') { if (result.ok) setPackages(result.data); else { setError(result.error); setPackages([]); } }
          else if (cmd === 'env-create' || cmd === 'env-remove' || cmd === 'env-rename') {
            if (result.ok) {
              const action = cmd.split('-')[1];
              setLogs(prev => [...prev, `--- Environment ${action}d successfully! Refreshing list... ---`]);
              // 自动刷新列表
              handleLoadEnvs(false); // 传入 false 表示这不是用户手动点击的，不需要重复探测
            } else { setError(result.error); }
          }
        } catch (e) { setLogs((prev) => [...prev, line]); }
      });
      const unlistenStderr = await listen<string>("backend://stderr", (event) => setLogs((prev) => [...prev, `[ERR] ${event.payload}`]));
      const unlistenTerminated = await listen<string>("backend://terminated", () => { setRunning(null); });
      return () => { unlistenStdout(); unlistenStderr(); unlistenTerminated(); };
    };
    const unlistenPromise = setupListeners();

    // 修正：应用启动时自动探测 Conda
    runCommand('probe');

    return () => { unlistenPromise.then(cleanup => cleanup && cleanup()); };
  }, []);

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

  // 新增：一个更健壮的加载环境列表的函数
  const handleLoadEnvs = async (probeFirst = true) => {
    // 如果是用户手动点击，或者还没有 condaInfo，就先探测
    if (probeFirst || !condaInfo) {
      await runCommand('probe');
    }
    runCommand('env-list');
  };

  const handleEnvSelect = (env: Environment) => {
    if (running) return;
    setSelectedEnvPath(env.path);
    setPackages([]); setSearchQuery("");
    runCommand('pkg-list', ['--prefix', env.path]);
  };

  const handleCreateEnv = () => {
    const name = prompt("请输入新环境的名称:", "my-new-env");
    if (!name || name.trim() === "") return;
    const pythonVersion = prompt("请输入 Python 版本 (例如 3.9):", "3.9");
    if (!pythonVersion || pythonVersion.trim() === "") return;
    runCommand('env-create', ['--name', name.trim(), '--python', pythonVersion.trim()]);
  };

  const handleRemoveEnv = async (env: Environment) => {
    if (running) return;
    const envName = env.path.split(/[\\/]/).pop() || env.path;
    const confirmed = await confirm(`您确定要删除环境 "${envName}" 吗？\n此操作不可恢复！`, { title: "删除确认" });
    if (confirmed) {
      if (selectedEnvPath === env.path) { setSelectedEnvPath(null); setPackages([]); }
      runCommand('env-remove', ['--prefix', env.path]);
    }
  };
  
  const handleRenameEnv = (env: Environment) => {
    if (running) return;
    const oldName = env.path.split(/[\\/]/).pop() || env.path;
    const newName = prompt(`请输入环境 "${oldName}" 的新名称:`, oldName);
    if (!newName || newName.trim() === "" || newName.trim() === oldName) return;
    runCommand('env-rename', ['--old-name', oldName, '--new-name', newName.trim()]);
  };

  // --- 派生状态 (Derived State) ---
  const sortedEnvironments = useMemo(() => {
    const rootPrefix = condaInfo?.root_prefix;
    // 修正：即使 condaInfo 还没加载完，也返回原始列表，防止界面闪烁
    if (!environments) return [];
    if (!rootPrefix) return environments;

    return [...environments].sort((a, b) => {
      const aIsBase = a.path === rootPrefix;
      const bIsBase = b.path === rootPrefix;
      if (aIsBase) return -1;
      if (bIsBase) return 1;
      return a.path.localeCompare(b.path);
    });
  }, [environments, condaInfo]);

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
          {/* 修正：移除“探测”按钮，改为自动探测 */}
          <button onClick={() => handleLoadEnvs()} disabled={!!running}>加载/刷新环境</button>
          <button onClick={() => setLogs([])} disabled={logs.length === 0}>清空日志</button>
        </div>
        {error && <div style={{ padding: 8, background: "#fff1f0", border: "1px solid #ffa39e", marginBottom: '12px' }}><strong>操作失败:</strong> {error}</div>}
        {condaInfo && <div style={{ padding: 8, background: "#e6ffed", border: "1px solid #b7eb8f", marginBottom: '12px' }}><strong>Conda 已就绪</strong> (版本: {condaInfo.conda_version})</div>}
        <h3>日志输出</h3>
        <div ref={logContainerRef} style={{ border: "1px solid #ccc", height: 400, overflow: "auto", padding: 12, background: "#fafafa", fontFamily: "monospace" }}>
          {logs.length === 0 ? <em>应用启动，自动探测 Conda...</em> : logs.map((l, i) => <div key={i}>{l}</div>)}
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
          sortedEnvironments.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {sortedEnvironments.map((env) => {
                const envName = env.path.split(/[\\/]/).pop() || env.path;
                // 修正：isBase 的判断现在总是可靠的
                const isBase = env.path === condaInfo?.root_prefix;
                const isSelected = env.path === selectedEnvPath;
                
                const baseStyle = isBase ? { backgroundColor: '#fffbe6', borderLeft: '3px solid #faad14' } : {};
                const selectedStyle = isSelected ? { backgroundColor: '#e6f7ff', borderLeft: '3px solid #1890ff' } : {};

                return (
                  <li key={env.path} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0', borderBottom: '1px solid #f0f0f0', ...baseStyle, ...(isSelected && !isBase ? selectedStyle : {}) }}>
                    <span onClick={() => handleEnvSelect(env)} style={{ flex: 1, padding: '8px 12px', cursor: 'pointer' }}>
                      {/* 新增：如果为 base，强制显示 'base' */}
                      <span style={{ fontWeight: 'bold' }}>{isBase ? 'base' : envName}</span>
                      <span style={{ fontSize: '0.8em', color: '#888', marginLeft: '8px' }}>({env.python_version})</span>
                    </span>
                    {!isBase && (
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <button onClick={() => handleRenameEnv(env)} disabled={!!running} title="重命名" style={{ background: 'none', border: 'none', color: '#1890ff', cursor: 'pointer', padding: '8px', fontSize: '14px' }}>Abc</button>
                        <button onClick={() => handleRemoveEnv(env)} disabled={!!running} title="删除" style={{ background: 'none', border: 'none', color: '#ff4d4f', cursor: 'pointer', padding: '8px', fontSize: '16px' }}>&times;</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : <p style={{ padding: '8px' }}>请点击“加载/刷新环境”</p>}
        </div>
        {/* 包列表部分 (保持不变) */}
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