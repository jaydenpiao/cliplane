export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "small" : ""}`}>
      <span className="brand-mark">
        <span />
        <span />
        <span />
      </span>
      <span>
        cliplane<span className="brand-dot">.</span>
      </span>
    </span>
  );
}
