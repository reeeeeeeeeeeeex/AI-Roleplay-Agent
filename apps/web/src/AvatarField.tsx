import { useRef, useState } from 'react';
import { api } from './api';
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
    setError('');
    setUploading(true);

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('读取本地文件失败'));
        reader.readAsDataURL(file);
      });

      const res = await api<{ url: string }>('/assets/upload', 'POST', {
        filename: file.name,
        dataUrl,
      });

      onChange(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传头像失败');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="avatar-field">
      <span className="avatar-field-label">{label}</span>
      <div className="avatar-field-control">
        <div className="avatar-field-preview" title={value ? '当前头像预览' : '未设置头像'}>
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
            {uploading ? '上传中…' : value ? '更换图片' : '选择图片'}
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
              title="清除头像"
            >
              <Trash2 size={13} />
              清除
            </button>
          )}
        </div>
      </div>
      {error && <small className="error">{error}</small>}
    </div>
  );
}
