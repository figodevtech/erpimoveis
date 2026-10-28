import { UiScaleOff } from "@/components/ui-scale-off";

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  // A DANFE fica fora da escala global da interface (ver --app-ui-scale em
  // globals.css), porque e um documento calibrado em mm.
  return (
    <div>
      <UiScaleOff />
      {children}
    </div>
  );
}
