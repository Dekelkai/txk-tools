import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, save, open, message } from "@tauri-apps/plugin-dialog";
import { ExportModal } from "./ExportModal";

// --- 接口定义 ---
interface CondaInfo {
  conda_version: string;
  python_version: string;
  root_prefix: string;
}
interface Environment {
  path: string;
  python_version: string;
}
interface Package {
  name: string;
  version: string;
  build: string;
  channel: string;
}

// --- 图标组件 ---
const CloneIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>;
const ExportIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const RenameIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const RemoveIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;

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
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportingEnv, setExportingEnv] = useState<Environment | null>(null);
  const subscribed = useRef(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // --- 效果钩子 ---
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (subscribed.current) return;
    subscribed.current = true;
    const setupListeners = async () => {
      const unlistenStdout = await listen<any>("backend://stdout", (event) => {
        const line = event.payload;
        try {
          const result = JSON.parse(line);
          const cmd = result.command;
          if (cmd === 'probe') {
            if (result.ok) {
              setCondaInfo(result.data);
            } else {
              setError(result.error);
            }
          }
          else if (cmd === 'env-list') {
            if (result.ok) {
              setEnvironments(result.data);
            } else {
              setError(result.error);
            }
          }
          else if (cmd === 'pkg-list') {
            if (result.ok) {
              setPackages(result.data);
            } else {
              setError(result.error);
              setPackages([]);
            }
          }
          else if (['env-create', 'env-remove', 'env-rename', 'env-import', 'env-clone'].includes(cmd)) {
            if (result.ok) {
              const action = cmd.split('-')[1];
              setLogs(prev => [...prev, `--- Environment ${action} operation successful! Refreshing list... ---`]);
              handleLoadEnvs(false);
            } else {
              setError(result.error);
            }
          }
          else if (cmd === 'env-export') {
            if (result.ok) {
              setLogs(prev => [...prev, `--- Environment exported successfully! ---`]);
            } else {
              setError(result.error);
            }
          }
        } catch (e) {
          setLogs((prev) => [...prev, line]);
        }
      });

      const unlistenStderr = await listen<string>("backend://stderr", (event) => {
        setLogs((prev) => [...prev, `[ERR] ${event.payload}`]);
      });

      const unlistenTerminated = await listen<string>("backend://terminated", () => {
        setRunning(null);
      });

      return () => {
        unlistenStdout();
        unlistenStderr();
        unlistenTerminated();
      };
    };

    const unlistenPromise = setupListeners();
    runCommand('probe');

    return () => {
      unlistenPromise.then(cleanup => cleanup && cleanup());
    };
  }, []);

  // --- 核心函数 ---
  const runCommand = async (command: string, extraArgs: string[] = []) => {
    if (running) return;
    
    const finalArgs = [command, ...extraArgs].filter(arg => arg !== '');
    const commandForLog = finalArgs.join(' ');

    setRunning(commandForLog);
    setLogs(prev => [...prev, `\n--- Starting command: ${commandForLog} ---`]);
    setError(null);

    try {
      await invoke("run_python_dev", { args: finalArgs });
    } catch (e: any) {
      setError(String(e));
      setRunning(null);
    }
  };

  const handleLoadEnvs = async (probeFirst = true) => {
    if (probeFirst) {
      await runCommand('probe');
    }
    runCommand('env-list');
  };

  const isEnvNameExists = (name: string) => {
    if (name.toLowerCase() === 'base') return true;
    return environments.some(env => (env.path.split(/[\\/]/).pop() || '').toLowerCase() === name.toLowerCase());
  };

  // --- 环境操作处理函数 ---
  const handleCreateEnv = async () => {
    const name = prompt("请输入新环境的名称:", "my-new-env");
    if (!name || name.trim() === "") return;
    const trimmedName = name.trim();

    if (isEnvNameExists(trimmedName)) {
      await message(`环境 "${trimmedName}" 已存在，请使用其他名称。`, { title: '创建失败' });
      return;
    }

    const pythonVersion = prompt("请输入 Python 版本 (例如 3.9):", "3.9");
    if (!pythonVersion || pythonVersion.trim() === "") return;

    runCommand('env-create', ['--name', trimmedName, '--python', pythonVersion.trim()]);
  };

  const handleEnvSelect = (env: Environment) => {
    if (running) return;
    setSelectedEnvPath(env.path);
    setPackages([]);
    setSearchQuery("");
    runCommand('pkg-list', ['--prefix', env.path]);
  };

  const handleRemoveEnv = async (env: Environment) => {
    if (running) return;
    const envName = env.path.split(/[\\/]/).pop() || env.path;
    const confirmed = await confirm(`您确定要删除环境 "${envName}" 吗？\n此操作不可恢复！`, { title: "删除确认" });
    if (confirmed) {
      if (selectedEnvPath === env.path) {
        setSelectedEnvPath(null);
        setPackages([]);
      }
      runCommand('env-remove', ['--prefix', env.path]);
    }
  };

  const handleRenameEnv = async (env: Environment) => {
    if (running) return;
    const oldName = env.path.split(/[\\/]/).pop() || env.path;
    const newName = prompt(`请输入环境 "${oldName}" 的新名称:`, oldName);
    if (!newName || newName.trim() === "" || newName.trim().toLowerCase() === oldName.toLowerCase()) return;
    const trimmedNewName = newName.trim();

    if (isEnvNameExists(trimmedNewName)) {
      await message(`环境 "${trimmedNewName}" 已存在，请使用其他名称。`, { title: '重命名失败' });
      return;
    }
    runCommand('env-rename', ['--old-name', oldName, '--new-name', trimmedNewName]);
  };

  const handleCloneEnv = async (env: Environment) => {
    if (running) return;
    const sourceName = env.path.split(/[\\/]/).pop() || env.path;
    const destName = prompt(`请输入克隆环境 "${sourceName}" 的新名称:`, `${sourceName}-clone`);
    if (!destName || destName.trim() === "") return;
    const trimmedDestName = destName.trim();

    if (trimmedDestName.toLowerCase() === sourceName.toLowerCase()) {
      await message('新环境名称不能与源环境相同。', { title: '克隆失败' });
      return;
    }
    if (isEnvNameExists(trimmedDestName)) {
      await message(`环境 "${trimmedDestName}" 已存在，请使用其他名称。`, { title: '克隆失败' });
      return;
    }
    runCommand('env-clone', ['--source-name', sourceName, '--dest-name', trimmedDestName]);
  };

  const openExportModal = (env: Environment) => {
    setExportingEnv(env);
    setIsExportModalOpen(true);
  };

  const handleExportFromModal = async (options: { format: 'yml' | 'txt'; noBuilds: boolean; }) => {
    if (!exportingEnv) return;
    const { format, noBuilds } = options;
    const envName = exportingEnv.path.split(/[\\/]/).pop() || exportingEnv.path;
    const defaultFileName = format === 'yml' ? `${envName}-environment.yml` : `${envName}-requirements.txt`;

    const filePath = await save({
      title: `导出环境为 ${format.toUpperCase()}`,
      defaultPath: defaultFileName,
      filters: [{ name: `${format.toUpperCase()} File`, extensions: [format] }]
    });

    if (filePath) {
      runCommand('env-export', ['--name', envName, '--file', filePath, '--format', format, noBuilds ? '--no-builds' : '']);
    }
    setIsExportModalOpen(false);
    setExportingEnv(null);
  };

  const handleImportEnv = async () => {
    if (running) return;
    const filePath = await open({
      title: '从文件导入环境',
      multiple: false,
      filters: [{ name: 'Environment File', extensions: ['yml', 'yaml', 'txt'] }]
    });
    if (typeof filePath === 'string') {
      const newName = prompt("请输入新环境的名称。\n此名称将作为你本地环境的名字。");
      if (!newName || newName.trim() === "") return;
      const trimmedName = newName.trim();

      if (isEnvNameExists(trimmedName)) {
        await message(`环境 "${trimmedName}" 已存在，请使用其他名称。`, { title: '导入失败' });
        return;
      }
      runCommand('env-import', ['--file', filePath, '--name', trimmedName]);
    }
  };

  // --- 派生状态 ---
  const sortedEnvironments = useMemo(() => {
    const rootPrefix = condaInfo?.root_prefix;
    if (!environments) return [];
    if (!rootPrefix) return environments;
    return [...environments].sort((a, b) => {
      if (a.path === rootPrefix) return -1;
      if (b.path === rootPrefix) return 1;
      return a.path.localeCompare(b.path);
    });
  }, [environments, condaInfo]);

  const filteredPackages = useMemo(() => {
    if (!searchQuery) return packages;
    return packages.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [packages, searchQuery]);

  // --- 渲染 ---
  return (
    <>
      <ExportModal
        isOpen={isExportModalOpen}
        envName={exportingEnv?.path.split(/[\\/]/).pop() || ''}
        onClose={() => { setIsExportModalOpen(false); setExportingEnv(null); }}
        onExport={handleExportFromModal}
      />
      <div style={{ padding: 16, fontFamily: "system-ui, sans-serif", display: 'flex', gap: '24px' }}>
        <div style={{ flex: 1 }}>
          <h1>TXK-Tools</h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '16px' }}>
            <button onClick={() => handleLoadEnvs(true)} disabled={!!running}>加载/刷新环境</button>
            <button onClick={() => setLogs([])} disabled={logs.length === 0}>清空日志</button>
          </div>
          
          {error && <div style={{ padding: 8, background: "#fff1f0", border: "1px solid #ffa39e", marginBottom: '12px' }}><strong>操作失败:</strong> {error}</div>}
          {condaInfo && <div style={{ padding: 8, background: "#e6ffed", border: "1px solid #b7eb8f", marginBottom: '12px' }}><strong>Conda 已就绪</strong> (版本: {condaInfo.conda_version})</div>}
          <h3>日志输出</h3>
          <div ref={logContainerRef} style={{ border: "1px solid #ccc", height: 400, overflow: "auto", padding: 12, background: "#fafafa", fontFamily: "monospace" }}>
            {logs.length === 0 ? <em>应用启动，自动探测 Conda...</em> : logs.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
        <div style={{ width: '500px', borderLeft: '1px solid #eee', paddingLeft: '24px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>环境列表</h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleImportEnv} disabled={!!running}>从文件导入</button>
              <button onClick={handleCreateEnv} disabled={!!running}>创建环境</button>
            </div>
          </div>
          <div style={{ border: '1px solid #ccc', height: '200px', overflowY: 'auto', marginBottom: '16px' }}>
            {running?.startsWith('env-list') ? <p style={{padding: '8px'}}>加载中...</p> : 
            sortedEnvironments.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {sortedEnvironments.map((env) => {
                  const envName = env.path.split(/[\\/]/).pop() || env.path;
                  const isBase = env.path === condaInfo?.root_prefix;
                  const isSelected = env.path === selectedEnvPath;
                  const baseStyle = isBase ? { backgroundColor: '#fffbe6', borderLeft: '3px solid #faad14' } : {};
                  const selectedStyle = isSelected ? { backgroundColor: '#e6f7ff', borderLeft: '3px solid #1890ff' } : {};

                  return (
                    <li key={env.path} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0', borderBottom: '1px solid #f0f0f0', ...baseStyle, ...(isSelected && !isBase ? selectedStyle : {}) }}>
                      <span onClick={() => handleEnvSelect(env)} style={{ flex: 1, padding: '8px 12px', cursor: 'pointer' }}>
                        <span style={{ fontWeight: 'bold' }}>{isBase ? 'base' : envName}</span>
                        <span style={{ fontSize: '0.8em', color: '#888', marginLeft: '8px' }}>({env.python_version})</span>
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', paddingRight: '8px' }}>
                        <button onClick={() => handleCloneEnv(env)} disabled={!!running} title="克隆环境" style={{ background: 'none', border: 'none', color: '#575fcf', cursor: 'pointer', padding: '8px' }}><CloneIcon /></button>
                        {!isBase && (
                          <>
                            <button onClick={() => openExportModal(env)} disabled={!!running} title="导出为文件" style={{ background: 'none', border: 'none', color: '#16a34a', cursor: 'pointer', padding: '8px' }}><ExportIcon /></button>
                            <button onClick={() => handleRenameEnv(env)} disabled={!!running} title="重命名" style={{ background: 'none', border: 'none', color: '#1890ff', cursor: 'pointer', padding: '8px' }}><RenameIcon /></button>
                            <button onClick={() => handleRemoveEnv(env)} disabled={!!running} title="删除" style={{ background: 'none', border: 'none', color: '#ff4d4f', cursor: 'pointer', padding: '8px' }}><RemoveIcon /></button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <p style={{ padding: '8px' }}>请点击“加载/刷新环境”</p>}
          </div>
          <h2>包列表 {selectedEnvPath && `(in ${selectedEnvPath.split(/[\\/]/).pop()})`}</h2>
          <input type="search" placeholder="搜索包名..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box' }}/>
          <div style={{ flex: 1, border: '1px solid #ccc', overflowY: 'auto' }}>
            {selectedEnvPath ? (
              running?.startsWith('pkg-list') ? <p style={{padding: '8px'}}>加载中...</p> :
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#fafafa' }}>
                  <tr><th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>名称</th><th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>版本</th><th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>渠道</th></tr>
                </thead>
                <tbody>
                  {filteredPackages.map((pkg, i) => (<tr key={`${pkg.name}-${i}`}><td style={{ padding: '8px', borderBottom: '1px solid #f0f0f0' }}>{pkg.name}</td><td style={{ padding: '8px', borderBottom: '1px solid #f0f0f0' }}>{pkg.version}</td><td style={{ padding: '8px', borderBottom: '1px solid #f0f0f0' }}>{pkg.channel}</td></tr>))}
                </tbody>
              </table>
            ) : <p style={{ padding: '8px' }}>请从上方选择一个环境</p>}
          </div>
        </div>
      </div>
    </>
  );
}

export default App;