export function Brain({ listening }: { listening: boolean }) {
  return (
    <div className={`brain ${listening ? "brain--listening" : ""}`} aria-hidden="true">
      <div className="brain__halo brain__halo--one" />
      <div className="brain__halo brain__halo--two" />
      <div className="brain__mesh" />
      <div className="brain__core" />
      {Array.from({ length: 9 }, (_, index) => (
        <i key={index} className={`brain__node brain__node--${index + 1}`} />
      ))}
    </div>
  );
}
