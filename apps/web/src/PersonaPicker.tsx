import { t } from './i18n.js';
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, User, Plus, Check } from 'lucide-react';
import type { Persona } from '@new-ai-chat/contracts';

export interface PersonaPickerProps {
  value: string | null;
  personas: Persona[];
  emptyLabel: string;
  defaultPersonaId?: string | null | undefined;
  disabled?: boolean | undefined;
  onChange: (personaId: string | null) => void;
  onCreatePersona?: (() => void) | undefined;
}

export default function PersonaPicker({
  value,
  personas,
  emptyLabel,
  defaultPersonaId,
  disabled = false,
  onChange,
  onCreatePersona,
}: PersonaPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedPersona = personas.find((p) => p.id === value);
  const fallbackPersona = !selectedPersona && defaultPersonaId ? personas.find((p) => p.id === defaultPersonaId) : undefined;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Display info on the collapsed trigger
  const displayAvatar = selectedPersona?.avatarPath ?? (value === null ? fallbackPersona?.avatarPath : null);
  const displayName = selectedPersona
    ? selectedPersona.name
    : defaultPersonaId !== undefined
    ? `${emptyLabel}${fallbackPersona ? t(" (当前: {0})", fallbackPersona.name) : t(" (当前: 未设置)")}`
    : emptyLabel;

  return (
    <div className={`persona-picker ${disabled ? 'disabled' : ''}`} ref={containerRef}>
      <button
        type="button"
        className={`persona-picker-trigger ${isOpen ? 'active' : ''}`}
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className="persona-picker-trigger-thumb">
          {displayAvatar ? (
            <img src={displayAvatar} alt="" />
          ) : (
            <div className="persona-picker-trigger-placeholder">
              {selectedPersona ? selectedPersona.name.slice(0, 1) : <User size={15} />}
            </div>
          )}
        </div>
        <span className="persona-picker-trigger-name" title={displayName}>
          {displayName}
        </span>
        <ChevronDown size={15} className={`persona-picker-chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="persona-picker-popover" role="listbox">
          <div className="persona-picker-grid">
            {/* Empty / Default option */}
            <div
              role="option"
              aria-selected={!value}
              className={`persona-picker-card empty-card ${!value ? 'selected' : ''}`}
              onClick={(event) => {
                event.preventDefault(); // Do not let the wrapping label reopen the trigger.
                onChange(null);
                setIsOpen(false);
              }}
            >
              <div className="persona-picker-card-image-wrap empty-wrap">
                <div className="persona-picker-empty-icon">
                  <User size={26} />
                </div>
                {!value && (
                  <div className="persona-picker-card-badge" title={t("当前选中")}>
                    <Check size={12} />
                  </div>
                )}
              </div>
              <div className="persona-picker-card-info">
                <div className="persona-picker-card-name" title={emptyLabel}>
                  {emptyLabel}
                </div>
                {defaultPersonaId !== undefined && (
                  <div className="persona-picker-card-desc">
                    {fallbackPersona ? t("跟随: {0}", fallbackPersona.name) : t("跟随: 未设置")}
                  </div>
                )}
              </div>
            </div>

            {/* Persona list */}
            {personas.map((p) => {
              const isSelected = p.id === value;
              return (
                <div
                  key={p.id}
                  role="option"
                  aria-label={p.name}
                  aria-selected={isSelected}
                  className={`persona-picker-card ${isSelected ? 'selected' : ''}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onChange(p.id);
                    setIsOpen(false);
                  }}
                >
                  <div className="persona-picker-card-image-wrap">
                    {p.avatarPath ? (
                      <>
                        <img className="character-card-bg-blur" src={p.avatarPath} alt="" aria-hidden="true" loading="lazy" />
                        <img className="character-card-img" src={p.avatarPath} alt={p.name} loading="lazy" />
                      </>
                    ) : (
                      <div className="character-card-placeholder">{p.name.slice(0, 1) || t("主")}</div>
                    )}
                    {isSelected && (
                      <div className="persona-picker-card-badge" title={t("当前选中")}>
                        <Check size={12} />
                      </div>
                    )}
                  </div>
                  <div className="persona-picker-card-info">
                    <div className="persona-picker-card-name" title={p.name}>
                      {p.name}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* New Persona shortcut */}
            {onCreatePersona && (
              <div
                role="button"
                className="persona-picker-card create-card"
                onClick={(event) => {
                  event.preventDefault();
                  setIsOpen(false);
                  onCreatePersona();
                }}
              >
                <div className="persona-picker-card-image-wrap create-wrap">
                  <Plus size={26} />
                </div>
                <div className="persona-picker-card-info">
                  <div className="persona-picker-card-name">{t("新建主角")}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
