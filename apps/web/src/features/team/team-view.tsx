'use client';

import { STATUS_TONE } from '@str-ops/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { Person } from '@/components/person';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { serverErrorText } from '@/lib/server-error';

import { LinksEditor } from './links-editor';
import { PasswordDialog, type PasswordSubject } from './password-dialog';
import { ResetPasswordDialog } from './reset-password-dialog';
import {
  countLinks,
  isInTab,
  matchesRole,
  matchesSearch,
  showsLinks,
  STAFF_ROLES,
  TEAM_TABS,
  type Staff,
  type StaffRole,
  type TeamTab,
} from './schema';
import { StaffForm } from './staff-form';
import { useCleanerLinks, useResetPassword, useStaff } from './use-team';

/** What the form is doing: nothing, adding somebody, or editing this person. */
type Editing = { staff: Staff | null } | null;

/**
 * The team.
 *
 * A table rather than cards: the questions asked here — who is a cleaner, who
 * speaks Czech, who still has no listings — are comparisons down a column, and
 * cards make the eye travel for each one.
 *
 * The three tabs are the ones the other sections use, and they mean the same:
 * who is working, who is not, and everybody. Somebody switched off keeps their
 * row and their history; there is no deleting a person who did the work.
 */
export function TeamView() {
  const { t } = useTranslation();
  const staff = useStaff();
  const links = useCleanerLinks();
  const reset = useResetPassword();

  const [tab, setTab] = useState<TeamTab>('working');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<StaffRole | ''>('');
  const [editing, setEditing] = useState<Editing>(null);
  const [linksFor, setLinksFor] = useState<Staff | null>(null);
  const [password, setPassword] = useState<PasswordSubject | null>(null);
  // Whose reset is being asked about: nothing is sent until the answer.
  const [resetFor, setResetFor] = useState<Staff | null>(null);

  const everybody = staff.data ?? [];
  // The filters narrow before the tabs count: a count that disagrees with the
  // list under it is worse than no count.
  const narrowed = everybody.filter(
    (person) => matchesSearch(person, search) && matchesRole(person, role),
  );
  const shown = narrowed.filter((person) => isInTab(person, tab));
  const allLinks = links.data ?? [];

  const resetFailure = reset.isError ? serverErrorText(reset.error) : null;

  const askForPassword = (person: Staff) => {
    reset.mutate(person.id, {
      onSuccess: (account) =>
        setPassword({
          account,
          name: nameOf(person),
          email: person.email ?? '',
        }),
    });
  };
  const confirmReset = (person: Staff) => {
    setResetFor(null);
    askForPassword(person);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('panel.team.title')}
        actions={
          <Button type="button" onClick={() => setEditing({ staff: null })}>
            {t('panel.team.add')}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-64"
          placeholder={t('panel.team.filters.search')}
          aria-label={t('panel.team.filters.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <NativeSelect
          aria-label={t('panel.team.filters.role')}
          value={role}
          onChange={(event) => setRole(event.target.value as StaffRole | '')}
        >
          <option value="">{t('panel.team.filters.anyRole')}</option>
          {STAFF_ROLES.map((option) => (
            <option key={option} value={option}>
              {t(`panel.roles.${option}`)}
            </option>
          ))}
        </NativeSelect>
      </div>

      <Tabs value={tab} onValueChange={(next) => setTab(next as TeamTab)}>
        <TabsList>
          {TEAM_TABS.map((name) => (
            <TabsTrigger key={name} value={name}>
              {t(`panel.team.tabs.${name}`)} (
              {narrowed.filter((person) => isInTab(person, name)).length})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {resetFailure === null ? null : (
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-sm text-destructive">{resetFailure.text}</p>
          {resetFailure.detail === null ? null : (
            <p className="text-xs text-muted-foreground">{resetFailure.detail}</p>
          )}
        </div>
      )}

      {staff.isPending ? (
        <LoadingState>{t('panel.team.loading')}</LoadingState>
      ) : staff.isError ? (
        <ErrorState message={t('panel.team.loadError')} error={staff.error} />
      ) : shown.length === 0 ? (
        <EmptyState>{t('panel.team.empty')}</EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('panel.team.columns.name')}</TableHead>
              <TableHead>{t('panel.team.columns.login')}</TableHead>
              <TableHead>{t('panel.team.columns.language')}</TableHead>
              <TableHead>{t('panel.team.columns.properties')}</TableHead>
              <TableHead className="text-right">{t('panel.team.columns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((person) => (
              <TableRow key={person.id}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <Person name={person.full_name} role={person.role} />
                    {person.is_active ? null : (
                      <Badge tone={STATUS_TONE['team.inactive']}>{t('panel.team.off')}</Badge>
                    )}
                  </div>
                  {person.phone === null ? null : (
                    <span className="text-xs text-muted-foreground">{person.phone}</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{person.email ?? '—'}</TableCell>
                <TableCell>
                  {person.preferred_language === null
                    ? t('panel.team.languageUnset')
                    : t(`common.languages.${person.preferred_language}`)}
                </TableCell>
                <TableCell>
                  {showsLinks(person, allLinks) ? (
                    // A 48 px target (design decision 5): for somebody not put on
                    // listings it is the one way to the links left to take off,
                    // and the form's warning sends the manager here.
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-12"
                      onClick={() => setLinksFor(person)}
                    >
                      {/* `total`, not `count`: «Объектов: N» only labels the
                          number, and a label stays one plain key (the rule of
                          the phone's i18n test); `count` would send i18next
                          looking for plural forms the files do not carry. */}
                      {t('panel.team.links.count', { total: countLinks(allLinks, person.id) })}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={reset.isPending || person.email === null}
                      onClick={() => setResetFor(person)}
                    >
                      {t('panel.team.resetPassword')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing({ staff: person })}
                    >
                      {t('panel.team.edit')}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {editing === null ? null : (
        <StaffForm
          staff={editing.staff}
          onClose={() => setEditing(null)}
          onCreated={(account, person, linkWarning) => {
            setEditing(null);
            setPassword({ account, name: person.name, email: person.email, linkWarning });
          }}
        />
      )}

      {linksFor === null ? null : <LinksEditor staff={linksFor} onClose={() => setLinksFor(null)} />}

      {resetFor === null ? null : (
        <ResetPasswordDialog
          name={nameOf(resetFor)}
          onConfirm={() => confirmReset(resetFor)}
          onClose={() => setResetFor(null)}
        />
      )}

      {password === null ? null : (
        <PasswordDialog subject={password} onClose={() => setPassword(null)} />
      )}
    </div>
  );
}

/** A person as the dialogs name her: the name, else the login. */
function nameOf(person: Staff): string {
  return person.full_name ?? person.email ?? '';
}
