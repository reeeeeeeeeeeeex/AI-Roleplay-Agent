import { t } from './i18n.js';
import { useState, useRef, useEffect, useId } from 'react';
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusOnOpen = useRef(false);
  const listId = useId();

  const selectedPersona = personas.find((p) => p.id === value);
  const fallbackPersona = !selectedPersona && defaultPersonaId ? personas.find((p) => p.id === defaultPersonaId) : undefined;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (disabled) { setIsOpen(false); return; }
    if (isOpen && focusOnOpen.current) {
      containerRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus();
    }
  }, [isOpen, disabled]);

  function select(id: string | null) {
    if (disabled) return;
    setIsOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
    onChange(id);
  }

  // Display info on the collapsed trigger
  const displayAvatar = selectedPersona?.avatarPath ?? (value === null ? fallbackPersona?.avatarPath : null);
  const displayName = selectedPersona
    ? selectedPersona.name
    : defaultPersonaId !== undefined
    ? `${emptyLabel}${fallbackPersona ? t(" (当前: {0})", fallbackPersona.name) : t(" (当前: 未设置)")}`
    : emptyLabel;

  return (
    <div className={`persona-picker ${disabled ? 'disabled' : ''}`} ref={containerRef}
      onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}
      onKeyDown={event => {
        if (disabled || event.nativeEvent.isComposing) return;
        if (event.target === triggerRef.current && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
          event.preventDefault(); focusOnOpen.current = true; setIsOpen(true);
          containerRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus();
          return;
        }
        if (!isOpen) return;
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); setIsOpen(false); triggerRef.current?.focus(); return;
        }
        const option = (event.target as HTMLElement).closest<HTMLElement>('[role="option"]');
        if (!option) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); option.click(); return; }
        const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
        const current = options.indexOf(option);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
          : ['ArrowDown', 'ArrowRight'].includes(event.key) ? Math.min(options.length - 1, current + 1)
          : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? Math.max(0, current - 1) : null;
        if (next !== null) { event.preventDefault(); options[next]?.focus(); }
      }}>
      <button
        ref={triggerRef}
        type="button"
        className={`persona-picker-trigger ${isOpen ? 'active' : ''}`}
        disabled={disabled}
        onClick={event => { focusOnOpen.current = event.detail === 0; setIsOpen(prev => !prev); }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
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
        <div className="persona-picker-popover">
          <div className="persona-picker-grid" role="listbox" id={listId} aria-label={t("主角身份")}>
            {/* Empty / Default option */}
            <div
              role="option"
              tabIndex={0}
              aria-selected={!value}
              className={`persona-picker-card empty-card ${!value ? 'selected' : ''}`}
              onClick={(event) => {
                event.preventDefault(); // Do not let the wrapping label reopen the trigger.
                select(null);
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
                  tabIndex={0}
                  aria-label={p.name}
                  aria-selected={isSelected}
                  className={`persona-picker-card ${isSelected ? 'selected' : ''}`}
                  onClick={(event) => {
                    event.preventDefault();
                    select(p.id);
                  }}
                >
                  <div className="persona-picker-card-image-wrap">
                    {p.avatarPath ? (
                      <>
                        <img className="character-card-bg-blur" src={p.avatarPath} alt="" aria-hidden="true" />
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

          </div>
          {onCreatePersona && (
            <button
              type="button"
              className="persona-picker-create"
              disabled={disabled}
              onClick={(event) => {
                event.preventDefault();
                setIsOpen(false);
                onCreatePersona();
              }}
            >
              <Plus size={16} />{t("新建主角")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
