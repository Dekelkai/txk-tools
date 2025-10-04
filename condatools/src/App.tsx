import { useEffect, useRef, useState } from "react";
import { invoke } from '@tauri-apps/api/core'
import { listen } from "@tauri-apps/api/event";

function App() {
  const [logs, setLogs] = useState<string[]>([]);
  const unsubRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    const setup = async () => {
      const u1 = await listen<string>("backend://stdout", (e) => {
        setLogs((prev) => [...prev, e.payload]);
      });
      const u2 = await listen<string>("backend://stderr", (e) => {
        setLogs((prev) => [...prev, `[ERR] ${e.payload}`]);
      });
      const u3 = await listen<string>("backend://terminated", (e) => {
        setLogs((prev) => [...prev, `Process terminated: code=${e.payload}`]);
      });
      unsubRef.current = [() => u1(), () => u2(), () => u3()];
    };
    setup();
    return () => { unsubRef.current.forEach((fn) => fn()); };
  }, []);

  const onProbe = async () => {
    setLogs([]);
    try {
      await invoke("run_python_dev", { args: ["probe"] });
    } catch (error) {
      console.error("探测失败:", error);
      // 可以设置错误日志或显示用户提示
      setLogs([`错误: ${error}`]);
    }
  };

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>TXK-Tools MVP</h1>
      <button onClick={onProbe}>检测 Conda（模拟）</button>
      <div style={{
        marginTop: 12, padding: 12, border: "1px solid #ccc", height: 240, overflow: "auto",
        whiteSpace: "pre-wrap", background: "#fafafa", fontFamily: "monospace"
      }}>
        {logs.length === 0 ? <em>无日志</em> : logs.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}

export default App;