/** "+" registration marks in the four corners of a panel (parent must be relative). */
export function Corners({ className = "text-faint" }: { className?: string }) {
  const c = `absolute ${className} text-[15px] leading-none select-none pointer-events-none`;
  return (
    <>
      <span className={`${c} top-3 left-3`}>+</span>
      <span className={`${c} top-3 right-3`}>+</span>
      <span className={`${c} bottom-3 left-3`}>+</span>
      <span className={`${c} bottom-3 right-3`}>+</span>
    </>
  );
}
