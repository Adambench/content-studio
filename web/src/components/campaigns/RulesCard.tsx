import { ChevronDown, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { RULE_KIND_LABELS, RULE_KINDS, type CampaignDetail, type RuleCheck, type RuleItem, type RuleKind } from '@shared/campaigns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';
import { cn } from '@/lib/utils';

const KIND_STYLE: Record<RuleKind, string> = {
  required: 'text-emerald-400',
  forbidden: 'text-rose-400',
  format: 'text-sky-400',
  caption: 'text-violet-400',
};

/** What the app will check by itself, in a few characters. */
export function checkText(check: RuleCheck | null) {
  if (!check) return null;
  switch (check.type) {
    case 'maxSeconds':
      return `≤ ${check.value} s`;
    case 'minSeconds':
      return `≥ ${check.value} s`;
    case 'mention':
    case 'hashtag':
      return String(check.value);
    case 'text':
      return `“${check.value}”`;
    case 'platform':
      return `only ${check.value}`;
    case 'watermark':
      return check.value === 'none' ? 'no watermark' : `watermark: ${check.value}`;
  }
}

/** The campaign's rules as a checklist: what every clip must and mustn't do. I can drop a rule or add my own. */
export function RulesCard({ campaign }: { campaign: CampaignDetail }) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<RuleKind>('required');
  const [showRaw, setShowRaw] = useState(false);
  const [busy, setBusy] = useState(false);

  async function saveRules(checklist: RuleItem[]) {
    setBusy(true);
    try {
      queryClient.setQueryData(keys.campaign(campaign.id), await api<CampaignDetail>(`/campaigns/${campaign.id}`, { method: 'PATCH', body: { checklist } }));
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await saveRules([...campaign.checklist, { text: text.trim(), kind, check: null, by: 'you' }])) setText('');
  }

  const rules = campaign.checklist;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rules</CardTitle>
        <CardDescription>
          Every clip is checked against these before you approve it. The ones with a tag are checked automatically; the rest are tick boxes at review. Rules you add stay when the page is read
          again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rules.length ? (
          <ul className="divide-y rounded-lg border">
            {rules.map((r, i) => (
              <li key={`${i}-${r.text}`} className="flex items-start gap-2.5 p-2.5">
                <span className={cn('w-14 shrink-0 pt-0.5 text-xs font-medium', KIND_STYLE[r.kind])}>{RULE_KIND_LABELS[r.kind]}</span>
                <div className="min-w-0 flex-1 text-sm">
                  {r.text}
                  <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                    {r.check && (
                      <Badge variant="outline" className="font-normal text-muted-foreground">
                        {checkText(r.check)}
                      </Badge>
                    )}
                    {r.by === 'you' && (
                      <Badge variant="outline" className="font-normal text-muted-foreground">
                        added by you
                      </Badge>
                    )}
                  </span>
                </div>
                <Button size="icon-sm" variant="ghost" disabled={busy} aria-label={`Remove “${r.text}”`} onClick={() => saveRules(rules.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
            {campaign.rulesLocked ? 'The rules are locked until you join the campaign.' : campaign.readAt ? 'The page gives no rules for the clips.' : 'Not read yet.'}
          </p>
        )}
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <Select value={kind} onValueChange={(v) => setKind(v as RuleKind)}>
            <SelectTrigger className="w-28" aria-label="Kind of rule">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RULE_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {RULE_KIND_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a rule" aria-label="New rule" className="min-w-0 flex-1 basis-48" />
          <Button type="submit" variant="outline" disabled={busy || !text.trim()}>
            <Plus /> Add
          </Button>
        </form>
        {campaign.rulesText && (
          <div className="space-y-2">
            <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setShowRaw((v) => !v)} aria-expanded={showRaw}>
              <ChevronDown className={cn('transition-transform', showRaw && 'rotate-180')} /> As the page words them
            </Button>
            {showRaw && <p className="rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{campaign.rulesText}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
