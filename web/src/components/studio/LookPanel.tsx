import { Palette, Save } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { applyTemplate, EDIT_FORMATS, templateFromEdit, type EditFormat, type Watermark } from '@shared/edit';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useStudio } from './context';
import { ChoiceSelect, Field, MediaSelect, SliderField } from './controls';

export function LookPanel() {
  const { workspace } = useWorkspaceContext();
  const { edit, spec, update, assets } = useStudio();
  const [confirmSave, setConfirmSave] = useState(false);
  const luts = assets.filter((m) => m.assetType === 'lut');
  const logos = assets.filter((m) => m.kind === 'image');
  const setWatermark = (patch: Partial<Watermark>) => update((s) => ({ ...s, watermark: { ...s.watermark, ...patch } }));

  async function saveTemplate() {
    try {
      await api(`/workspaces/${workspace.id}`, { method: 'PATCH', body: { editTemplate: templateFromEdit(spec) } });
      queryClient.invalidateQueries({ queryKey: keys.workspace(workspace.id) });
      toast.success('Saved as this brand’s video look', { description: 'New edits start with it.' });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Shape</h3>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(EDIT_FORMATS) as EditFormat[]).map((f) => {
            const fmt = EDIT_FORMATS[f];
            return (
              <button
                key={f}
                type="button"
                onClick={() => update((s) => ({ ...s, format: f }))}
                className={cn('flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-center hover:bg-accent/60', spec.format === f && 'border-brand/60 bg-brand-soft')}
              >
                <span className="block rounded-sm border-2 border-current opacity-70" style={{ width: 22 * (fmt.width / fmt.height) + 6, height: 28 }} />
                <span className="text-sm font-medium">{f}</span>
                <span className="text-[11px] leading-tight text-muted-foreground">{fmt.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Grading is a module: off, the section only shows to take off a grade that's still on. */}
      {(workspace.modules.includes('grading') || spec.grade.lutMediaId) && (
        <section className="space-y-4 border-t pt-4">
          <h3 className="text-sm font-medium">Colour grade</h3>
          <Field label="LUT" hint={luts.length ? undefined : 'No LUTs yet'}>
            <MediaSelect value={spec.grade.lutMediaId} onChange={(lutMediaId) => update((s) => ({ ...s, grade: { ...s.grade, lutMediaId } }))} options={luts} noneLabel="No grade" />
          </Field>
          {spec.grade.lutMediaId ? (
            <>
              <SliderField label="Strength" value={spec.grade.intensity} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(intensity) => update((s) => ({ ...s, grade: { ...s.grade, intensity } }))} />
              <p className="text-xs text-muted-foreground">The grade is applied when rendering — the preview shows the footage ungraded.</p>
            </>
          ) : (
            !luts.length && (
              <p className="text-xs text-muted-foreground">
                Import .cube files in{' '}
                <Link to={`/w/${edit.workspaceId}/assets`} className="underline underline-offset-2">
                  Brand assets
                </Link>
                .
              </p>
            )
          )}
        </section>
      )}

      <section className="space-y-4 border-t pt-4">
        <h3 className="text-sm font-medium">Watermark</h3>
        <Field label="Logo">
          <MediaSelect value={spec.watermark.mediaId} onChange={(mediaId) => setWatermark({ mediaId })} options={logos} noneLabel="No watermark" />
        </Field>
        {spec.watermark.mediaId && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Corner">
              <ChoiceSelect
                label="Corner"
                value={spec.watermark.corner}
                onChange={(corner) => setWatermark({ corner })}
                options={[
                  { value: 'tl', label: 'Top left' },
                  { value: 'tr', label: 'Top right' },
                  { value: 'bl', label: 'Bottom left' },
                  { value: 'br', label: 'Bottom right' },
                ]}
              />
            </Field>
            <SliderField label="Size" value={spec.watermark.size} min={0.05} max={0.5} format={(v) => `${Math.round(v * 100)}%`} onChange={(size) => setWatermark({ size })} />
            <SliderField label="Opacity" value={spec.watermark.opacity} min={0.1} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => setWatermark({ opacity })} />
          </div>
        )}
      </section>

      <section className="space-y-3 border-t pt-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Palette className="size-4" /> Brand look
          </h3>
          <p className="text-xs text-muted-foreground">Shape, captions, grade, watermark and voice settings — new edits in {workspace.name} start with the saved look.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => (workspace.editTemplate ? setConfirmSave(true) : saveTemplate())}>
            <Save /> Save this look
          </Button>
          {workspace.editTemplate && (
            <Button size="sm" variant="ghost" onClick={() => update((s) => applyTemplate(s, workspace.editTemplate!))}>
              Apply the saved look
            </Button>
          )}
        </div>
      </section>

      <AlertDialog open={confirmSave} onOpenChange={setConfirmSave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the brand look?</AlertDialogTitle>
            <AlertDialogDescription>{workspace.name} already has a saved video look. New edits will start with this one instead; existing edits don’t change.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={saveTemplate}>Replace</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
