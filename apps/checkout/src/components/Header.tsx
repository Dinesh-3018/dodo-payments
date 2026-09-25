import { ChevronIcon, CloseIcon } from "./icons";

interface Props {
  name: string;
  logo?: string;
  total?: string;
  expanded: boolean;
  onToggle: () => void;
  onClose: () => void;
  closeDisabled: boolean;
}

export function Header({ name, logo, total, expanded, onToggle, onClose, closeDisabled }: Props) {
  return (
    <header className="hdr">
      <div className="hdr-brand">
        {logo ? (
          <img className="hdr-logo" src={logo} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="hdr-mark" aria-hidden="true">
            {name.trim().charAt(0).toUpperCase() || "•"}
          </span>
        )}
        <span className="hdr-name">{name}</span>
      </div>
      <div className="hdr-right">
        {total && (
          <button type="button" className="hdr-total" onClick={onToggle} aria-expanded={expanded} aria-controls="summary">
            <span className="hdr-total-label">Total</span>
            <span className="hdr-total-amount">{total}</span>
            <span className={"hdr-chevron" + (expanded ? " is-open" : "")}>
              <ChevronIcon />
            </span>
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label="Close checkout"
          title={closeDisabled ? "Hang on, we're confirming your payment" : "Close"}
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}
