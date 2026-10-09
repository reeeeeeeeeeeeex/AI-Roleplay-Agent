import { t, diagnosticText } from './i18n.js';
import { useRef, useState } from 'react';
import { Image as ImageIcon, Upload, Trash2 } from 'lucide-react';

export default function AvatarField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      setError(t("图片不能超过 100 MB。"));
      event.target.value = '';
      return;
    }
    setError('');
    setUploading(true);

    try {
      const response = await fetch('/api/assets/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const result = await response.json();
      if (!response.ok) throw new Error(diagnosticText(result.errorText, result.error ?? t("上传失败 ({0})", response.status)));
      onChange(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("上传头像失败"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="avatar-field">
      <span className="avatar-field-label">{label}</span>
      <div className="avatar-field-control">
        <div className="avatar-field-preview" title={value ? t("当前头像预览") : t("未设置头像")}>
          {value ? (
            <img src={value} alt={label} />
          ) : (
            <ImageIcon size={20} className="avatar-field-placeholder" />
          )}
        </div>
        <div className="avatar-field-actions">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={handleFileChange}
            disabled={disabled || uploading}
          />
          <button
            type="button"
            className="avatar-field-btn"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
          >
            <Upload size={13} />
            {uploading ? t("上传中…") : value ? t("更换图片") : t("选择图片")}
          </button>
          {value && (
            <button
              type="button"
              className="danger avatar-field-btn"
              disabled={disabled || uploading}
              onClick={() => {
                setError('');
                onChange(null);
              }}
              title={t("清除")}
            >
              <Trash2 size={13} />
              {t("清除")}</button>
          )}
        </div>
      </div>
      <div className="avatar-field-path-row">
        <input
          type="text"
          className="avatar-field-path-input"
          placeholder={t("或输入本地图片路径 / URL (如 /api/assets/...)")}
          value={value ?? ''}
          disabled={disabled || uploading}
          onChange={(e) => {
            setError('');
            onChange(e.target.value.trim() || null);
          }}
        />
      </div>
      {error && <small className="error">{error}</small>}
    </div>
  );
}
