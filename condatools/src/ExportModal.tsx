import React, { useState } from 'react';

interface ExportModalProps {
  envName: string;
  isOpen: boolean;
  onClose: () => void;
  onExport: (options: { format: 'yml' | 'txt'; noBuilds: boolean }) => void;
}

const InfoTooltip = ({ text }: { text: string }) => (
  <span title={text} style={{ cursor: 'help', marginLeft: '8px', borderBottom: '1px dotted', color: '#888' }}>
    ?
  </span>
);

export const ExportModal: React.FC<ExportModalProps> = ({ envName, isOpen, onClose, onExport }) => {
  const [format, setFormat] = useState<'yml' | 'txt'>('yml');
  const [noBuilds, setNoBuilds] = useState(true);

  if (!isOpen) return null;

  const handleExportClick = () => {
    onExport({ format, noBuilds });
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
    }}>
      <div style={{
        background: 'white', color: '#333', padding: '24px', borderRadius: '8px',
        width: '400px', boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
      }}>
        <h2 style={{ marginTop: 0, marginBottom: '24px' }}>导出环境: {envName}</h2>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px' }}>导出格式</label>
          <div>
            <label style={{ marginRight: '16px' }}>
              <input type="radio" name="format" value="yml" checked={format === 'yml'} onChange={() => setFormat('yml')} />
              YML (推荐)
            </label>
            <label>
              <input type="radio" name="format" value="txt" checked={format === 'txt'} onChange={() => setFormat('txt')} />
              TXT (pip 兼容)
            </label>
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '12px' }}>高级选项</label>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
            <input type="checkbox" id="noBuilds" checked={noBuilds} onChange={(e) => setNoBuilds(e.target.checked)} />
            <label htmlFor="noBuilds" style={{ marginLeft: '8px' }}>移除构建版本号</label>
            <InfoTooltip text="勾选后，导出的文件中将不包含具体的构建版本号 (如 py39h6e24b1b_0)。这会提高跨平台的兼容性，但可能降低环境复现的精确度。" />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={onClose} style={{ background: '#eee' }}>取消</button>
          <button onClick={handleExportClick}>继续并选择保存位置</button>
        </div>
      </div>
    </div>
  );
};