export default function PrintLayout({ children }: { children: React.ReactNode }) {
  // data-ui-scale="off": a DANFE fica fora da escala global da interface
  // (ver --app-ui-scale em globals.css), porque e um documento calibrado em mm.
  return <div data-ui-scale="off">{children}</div>;
}