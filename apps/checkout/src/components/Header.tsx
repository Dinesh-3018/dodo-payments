import { CloseIcon } from "./icons";

interface Props {
  name: string;
  logo?: string;
  onClose: () => void;
  closeDisabled: boolean;
}

export function Header({ name, logo, onClose, closeDisabled }: Props) {
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
    </header>
  );
}
