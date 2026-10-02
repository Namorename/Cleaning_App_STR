# Přejmenování sekcí — čeština ke kontrole

Aplikace pro úklid krátkodobých pronájmů: panel manažera a aplikace pro uklízečky a techniky. Majitel přejmenovává dvě sekce:

- sekce „Úkoly“ (úklidy, kontroly a opravy) se bude jmenovat **„Úklidy“** — i když obsahuje kontroly a opravy;
- sekce „Problémy“ (co nahlásí uklízečky) se bude jmenovat **„Úkoly“**;
- práce technika podle úkolu = **„práce“**; hotový úkol = **„Splněný“** (dříve „Vyřešený“ u problému).

Prosíme o kontrolu gramatiky (pády, množné číslo) a přirozenosti. Nejdůležitější: tvary u `panel.calendar.moreTasks` a volba „splněný“ místo „vyřešený“. Každý řádek: klíč: bylo → bude — pád nebo důvod. Texty v {{složených závorkách}} se nepřekládají.

- `panel.nav.problems`: Problémy → Úkoly — 1. pád mn. č.
- `panel.nav.tasks`: Úkoly → Úklidy — 1. pád mn. č.
- `panel.tasks.title`: Úkoly → Úklidy — 1. pád mn. č.
- `panel.tasks.loading`: Načítáme úkoly… → Načítáme úklidy… — 4. pád mn. č.
- `panel.tasks.loadError`: Úkoly se nepodařilo načíst → Úklidy se nepodařilo načíst — 4. pád mn. č. (předmět infinitivu)
- `panel.tasks.empty`: Zatím žádné úkoly → Zatím žádné úklidy — 1. pád mn. č.
- `panel.tasks.statuses.assigned`: Přiděleno — beze změny („Přiděleno“ je neosobní střední rod)
- `panel.tasks.statuses.accepted`: Přijato — beze změny
- `panel.tasks.statuses.blocked`: Blokováno — beze změny
- `panel.tasks.statuses.done`: Hotovo — beze změny
- `panel.tasks.statuses.cancelled`: Zrušeno — beze změny
- `panel.tasks.statuses.expired`: Propadlo — beze změny
- `panel.tasks.overdue`: Propadlo — beze změny
- `panel.tasks.origin.problem`: Z problému → Z úkolu — 2. pád j. č. (z úkolu)
- `panel.tasks.actions.new`: Nový úkol → Nový úklid — 1. pád j. č.
- `panel.tasks.actions.cancel`: Zrušit úkol → Zrušit úklid — 4. pád j. č.
- `panel.tasks.actions.cancelConfirm`: Zrušit tento úkol? Zůstane v historii. → Zrušit tento úklid? Zůstane v historii. — 4. pád j. č.; „zůstane“ beze změny
- `panel.tasks.form.titleNew`: Nový úkol → Nový úklid — 1. pád j. č.
- `panel.tasks.form.titleEdit`: Upravit úkol → Upravit úklid — 4. pád j. č.
- `panel.tasks.form.description`: Volitelné: bez názvu se úkol jmenuje podle svého druhu — „Úklid“, „Kontrola“. → Volitelné: bez názvu se ukáže druh — „Úklid“, „Kontrola“. — podstatné jméno vypuštěno („úklid se jmenuje „Kontrola““ by si odporovalo)
- `panel.tasks.form.type`: Druh úkolu → Druh — podstatné jméno vypuštěno, jako u filtru „Druh“; doslovně „Druh úklidu“
- `panel.tasks.form.assigneeRequired`: Kontrola a údržba musí mít přiřazeného pracovníka: vyberte, kdo úkol udělá. → Kontrola a údržba musí mít přiřazeného pracovníka: vyberte, kdo práci udělá. — 4. pád j. č. (práci)
- `panel.tasks.form.generatedHint`: Úkol vznikl z rezervace nebo z problému: byt ani druh nelze změnit. → Úklid vznikl z rezervace nebo z úkolu: byt ani druh nelze změnit. — 1. pád j. č. (úklid vznikl); z úkolu — 2. pád
- `panel.tasks.work.titleOpen`: Úkol → Úklid — 1. pád j. č.
- `panel.tasks.work.noSteps`: Úkol neměl žádné kroky → Úklid neměl žádné kroky — 1. pád j. č.; „neměl“ beze změny (mužský rod)
- `panel.tasks.work.problems`: Problémy z tohoto úklidu → Úkoly z tohoto úklidu — 1. pád mn. č.
- `panel.tasks.work.noProblems`: Žádné problémy nebyly nahlášeny → Žádné úkoly nebyly nahlášeny — 1. pád mn. č.
- `panel.problems.title`: Problémy → Úkoly — 1. pád mn. č.
- `panel.problems.empty`: Žádné problémy → Žádné úkoly — 1. pád mn. č.
- `panel.problems.loading`: Načítáme problémy… → Načítáme úkoly… — 4. pád mn. č.
- `panel.problems.loadError`: Problémy se nepodařilo načíst → Úkoly se nepodařilo načíst — 4. pád mn. č. (předmět infinitivu)
- `panel.problems.notFound`: Problém nenalezen → Úkol nenalezen — 1. pád j. č.; „nenalezen“ beze změny
- `panel.problems.columns.title`: Problém → Úkol — 1. pád j. č.
- `panel.problems.columns.reported`: Nahlášeno — beze změny („Nahlášeno“ je neosobní)
- `panel.problems.detail.back`: Zpět na problémy → Zpět na úkoly — 4. pád mn. č. (na úkoly)
- `panel.problems.detail.reportedAt`: Nahlášeno {{date}} — beze změny
- `panel.problems.detail.fromTask`: Nalezeno během úklidu — beze změny („Nalezeno“ je neosobní)
- `panel.problems.detail.fixTask`: Úkol opravy → Práce technika — 1. pád j. č. (práce), technika — 2. pád
- `panel.problems.detail.steps`: Kroky úkolu → Kroky práce — 2. pád j. č. (práce)
- `panel.problems.detail.noSteps`: Kroky se objeví, až technik úkol zahájí → Kroky se objeví, až technik zahájí práci — 4. pád j. č. (práci)
- `panel.problems.detail.resolvedAt`: Vyřešeno {{date}} → Splněno {{date}} — neosobní střední rod; sloveso splnit
- `panel.problems.detail.cancelledAt`: Zrušeno {{date}} — beze změny
- `panel.problems.detail.taskStatus`: Stav úkolu: {{status}} → Stav práce: {{status}} — 2. pád j. č. (práce)
- `panel.problems.assign.noProperty`: Problém nemá objekt, úkol proto nelze naplánovat → Úkol nemá objekt, práci proto nelze naplánovat — 1. pád j. č. (úkol); práci — 4. pád
- `panel.problems.actions.resolve`: Označit jako vyřešený → Označit jako splněný — 1. pád j. č. m. r. (jako splněný)
- `panel.problems.actions.cancel`: Zrušit problém → Zrušit úkol — 4. pád j. č.
- `panel.problems.actions.archiveText`: Problém zmizí z nástěnky, ze seznamu i z aplikací zaměstnanců. Nic se nemaže: lze ho vrátit ze záložky Archiv. → Úkol zmizí z nástěnky, ze seznamu i z aplikací zaměstnanců. Nic se nemaže: lze ho vrátit ze záložky Archiv. — 1. pád j. č.; „ho“ beze změny
- `panel.problems.board.startOnPhone`: Do práce problém převádí technik, když úkol zahájí v aplikaci → Do práce úkol převádí technik tlačítkem „Začít práci“ v aplikaci — 4. pád j. č. (úkol); název tlačítka z `tasks.work.start`
- `panel.problems.board.unassigned`: Úkol technika je zrušen, problém je znovu otevřený → Práce technika je zrušena, úkol je znovu otevřený — práce (ž. r.) → „zrušena“; úkol → „otevřený“ beze změny
- `panel.problems.board.resolveTitle`: Označit jako vyřešený? → Označit jako splněný? — jako splněný — m. r.
- `panel.problems.board.resolveText`: „{{title}}“ se uzavře jako vyřešený. Úkol technika, pokud existuje, bude dokončen. → „{{title}}“ se uzavře jako splněný. Práce technika, pokud existuje, bude dokončena. — jako splněný (m. r., úkol); práce → „dokončena“ (ž. r.)
- `panel.problems.board.resolveConfirm`: Ano, vyřešeno → Ano, splněno — neosobní střední rod
- `panel.problems.board.reopened`: Problém je znovu otevřený → Úkol je znovu otevřený — 1. pád j. č.; „otevřený“ beze změny
- `panel.problems.board.columnEmpty`: ✨ Zatím žádné problémy → ✨ Zatím žádné úkoly — 1. pád mn. č.
- `panel.problems.archive.hint`: Archivované problémy zaměstnanci nevidí a na nástěnce nejsou. Obnovený problém se vrátí ve stejném stavu. → Archivované úkoly zaměstnanci nevidí a na nástěnce nejsou. Obnovený úkol se vrátí ve stejném stavu. — 4. pád mn. č.; 1. pád j. č.
- `panel.calendar.moreTasks_one`: Ještě {{count}} úkol → Ještě {{count}} úklid — 1. pád j. č. (1)
- `panel.calendar.moreTasks_few`: Ještě {{count}} úkoly → Ještě {{count}} úklidy — 1. pád mn. č. (2–4)
- `panel.calendar.moreTasks_many`: Ještě {{count}} úkolu → Ještě {{count}} úklidu — 2. pád j. č. (desetinná čísla)
- `panel.calendar.moreTasks_other`: Ještě {{count}} úkolů → Ještě {{count}} úklidů — 2. pád mn. č. (5 a více)
- `panel.calendar.loadingTasks`: Načítáme úkoly… → Načítáme úklidy… — 4. pád mn. č.
- `panel.calendar.tasksError`: Úkoly se nepodařilo načíst. → Úklidy se nepodařilo načíst. — 4. pád mn. č. (předmět infinitivu)
- `panel.calendar.filters.open`: Otevřené — beze změny („Otevřené“)
- `panel.calendar.filters.done`: Hotovo — beze změny
- `panel.calendar.filters.nobody`: Nepřiřazeno — beze změny („Nepřiřazeno“)
- `panel.calendar.stand.newTask`: Nový úkol: {{place}}, {{day}} → Nový úklid: {{place}}, {{day}} — 1. pád j. č.
- `panel.calendar.expiredMark`: Neproběhlo — beze změny
- `panel.calendar.overdue`: Po termínu — beze změny
- `panel.calendar.chipView`: Zobrazení úkolů → Zobrazení úklidů — 2. pád mn. č.
- `panel.calendar.expiredError`: Neproběhlé úkoly se nepodařilo načíst. → Neproběhlé úklidy se nepodařilo načíst. — 4. pád mn. č. (předmět infinitivu)
- `panel.calendar.cancelledError`: Zrušené úkoly se nepodařilo načíst. → Zrušené úklidy se nepodařilo načíst. — 4. pád mn. č. (předmět infinitivu)
- `panel.calendar.taskMissing`: Úkol se nepodařilo otevřít. → Úklid se nepodařilo otevřít. — 4. pád j. č. (předmět infinitivu)
- `panel.settings.galleryHint`: Vypnuto: fotky a video se pořizují jen fotoaparátem a přímo na místě. Zapnuto: uklízečka může přiložit hotový soubor z galerie — i pořízený v jiném bytě nebo před týdnem, a pak médium přestává být důkazem o stavu bytu v době úklidu. Platí pro úklidy i pro řešení problémů. → Vypnuto: fotky a video se pořizují jen fotoaparátem a přímo na místě. Zapnuto: uklízečka může přiložit hotový soubor z galerie — i pořízený v jiném bytě nebo před týdnem, a pak médium přestává být důkazem o stavu bytu v době úklidu. Platí pro úklidy i pro úkoly. — 4. pád mn. č. (pro úkoly)
- `panel.settings.workflow.runningNote`: Úprava se nedotkne úkolů, které už běží: každý jde podle snímku pořízeného při startu. → Úprava se nedotkne úklidů, které už běží: každý jde podle snímku pořízeného při startu. — 2. pád mn. č.; „každý“ beze změny
- `panel.settings.workflow.scopes.problem`: Řešení problémů → Práce na úkolech — 6. pád mn. č. (na úkolech)
- `panel.settings.workflow.none`: Pro tento druh úkolu zatím proces není. Přidejte kroky a uložte. → Pro tento druh zatím proces není. Přidejte kroky a uložte. — podstatné jméno vypuštěno
- `panel.settings.workflow.stepTypes.task_note`: Poznámka k úkolu → Poznámka k úklidu — 3. pád j. č. (k úklidu)
- `panel.team.form.propertiesHint`: Zaměstnanec vidí úkoly jen u objektů, které jsou tu zaškrtnuté. → Zaměstnanec vidí úklidy jen u objektů, které jsou tu zaškrtnuté. — 4. pád mn. č.
- `panel.team.links.description`: „Napevno“ přiřadí úkol hned, jak vznikne. „Z fronty“ ho nechá tomu, kdo si ho vezme první. → „Napevno“ přiřadí úklid hned, jak vznikne. „Z fronty“ ho nechá tomu, kdo si ho vezme první. — 4. pád j. č.; „ho“ beze změny
- `panel.chat.audienceTask`: Vidí ti, kdo vidí úkol: přidělený pracovník, uklízečky objektu a manažeři → Vidí ti, kdo vidí úklid: přidělený pracovník, uklízečky objektu a manažeři — 4. pád j. č.
- `panel.chat.audienceProblem`: Vidí ti, kdo vidí závadu: kdo ji nahlásil, technik a manažeři — beze změny („závadu“ je synonymum, ne název sekce)
- `panel.dashboard.emptyHint`: Čísla přijdou spolu se sekcemi. Začněte problémy a žádostmi o materiál. → Čísla přijdou spolu se sekcemi. Začněte úkoly a žádostmi o materiál. — 7. pád mn. č. (začněte čím: úkoly)
- `panel.apartments.info.cleanerNotesHint`: Zobrazí se v aplikaci u úkolu. → Zobrazí se v aplikaci u úklidu. — 2. pád j. č. (u úklidu)
- `tabs.myTasks`: Moje úkoly → Moje úklidy — 1. pád mn. č.
- `tabs.problems`: Problémy → Úkoly — 1. pád mn. č.
- `tasks.loading`: Načítáme úkoly… → Načítáme úklidy… — 4. pád mn. č.
- `tasks.loadFailed`: Úkoly se nepodařilo načíst → Úklidy se nepodařilo načíst — 4. pád mn. č. (předmět infinitivu)
- `tasks.emptyMine`: Zatím vám nebyl přidělen žádný úkol. Podívejte se do „Volné“ — na vašich objektech může být práce. → Zatím vám nebyl přidělen žádný úklid. Podívejte se do „Volné“ — na vašich objektech může být práce. — 1. pád j. č.; „žádný“, „přidělen“ beze změny
- `tasks.claimFailedTitle`: Úkol se nepodařilo vzít → Úklid se nepodařilo vzít — 4. pád j. č. (předmět infinitivu)
- `tasks.claimTaken`: Úkol si už někdo vzal, nebo už vypršel. → Úklid si už někdo vzal, nebo už vypršel. — 4. pád j. č.; „vypršel“ beze změny
- `tasks.startFailed`: Úkol se nepodařilo začít — obnovte seznam. → Úklid se nepodařilo začít — obnovte seznam. — 4. pád j. č. (předmět infinitivu)
- `tasks.finishFailed`: Úkol se nepodařilo dokončit — obnovte seznam. → Úklid se nepodařilo dokončit — obnovte seznam. — 4. pád j. č. (předmět infinitivu)
- `tasks.detail.startedAt`: Začátek — beze změny
- `tasks.detail.completedAt`: Konec — beze změny
- `tasks.detail.parallel`: Probíhal souběžně s jiným úkolem → Probíhal souběžně s jiným úklidem — 7. pád j. č. (s jiným úklidem)
- `tasks.detail.closed`: Úkol je uzavřen → Úklid je uzavřen — 1. pád j. č.
- `tasks.detail.reportProblem`: Nahlásit problém → Vytvořit úkol — 4. pád j. č.
- `tasks.detail.problem`: Problém → Úkol — 1. pád j. č.
- `tasks.detail.openProblem`: Otevřít problém → Otevřít úkol — 4. pád j. č.
- `tasks.detail.notFound`: Úkol nenalezen, nebo už není váš → Úklid nenalezen, nebo už není váš — 1. pád j. č.; „váš“ beze změny
- `steps.types.task_note`: Pokyny k úkolu → Pokyny k úklidu — 3. pád j. č. (k úklidu)
- `steps.commentPlaceholder`: Co by měla kancelář vědět o tomto úkolu… → Co by měla kancelář vědět o tomto úklidu… — 6. pád j. č. (o tomto úklidu)
- `steps.readOnly`: Kroky lze měnit, jen dokud úkol probíhá → Kroky lze měnit, jen dokud úklid probíhá — 1. pád j. č.
- `problems.report`: Nahlásit problém → Vytvořit úkol — 4. pád j. č.
- `problems.new`: Nový problém → Nový úkol — 1. pád j. č.
- `problems.one`: Problém → Úkol — 1. pád j. č.
- `problems.loading`: Načítáme problémy… → Načítáme úkoly… — 4. pád mn. č.
- `problems.emptyMine`: Žádné nahlášené problémy → Žádné nahlášené úkoly — 1. pád mn. č.
- `problems.notFound`: Problém nenalezen → Úkol nenalezen — 1. pád j. č.
- `problems.notEditable`: Problém už někdo převzal — nelze ho změnit → Úkol už někdo převzal — nelze ho změnit — 4. pád j. č.; „ho“ beze změny
- `problems.statuses.open`: Otevřený — beze změny („Otevřený“ (m. r., úkol))
- `problems.statuses.assigned`: Přidělený — beze změny („Přidělený“)
- `problems.statuses.resolved`: Vyřešený → Splněný — m. r. (úkol); splnit úkol místo vyřešit problém
- `problems.statuses.cancelled`: Zrušený — beze změny („Zrušený“)
- `problems.openFixTask`: Otevřít úkol opravy → Otevřít práci technika — 4. pád j. č. (práci)
- `serverErrors.parallelStartOff`: Nejprve dokončete probíhající úkol — souběžný start je vypnutý → Nejprve dokončete probíhající úklid — souběžný start je vypnutý — 4. pád j. č.
- `serverErrors.startTooEarly`: Úkol nelze začít dříve než v {{time}} ({{date}}) → Úklid nelze začít dříve než v {{time}} ({{date}}) — 4. pád j. č. (předmět infinitivu)
- `serverErrors.problemNotFound`: Problém nenalezen → Úkol nenalezen — 1. pád j. č.
- `serverErrors.problemNotOpen`: Problém už někdo převzal — nelze ho změnit → Úkol už někdo převzal — nelze ho změnit — 4. pád j. č.
- `serverErrors.problemArchived`: Problém je v archivu — před přidělením ho obnovte → Úkol je v archivu — před přidělením ho obnovte — 1. pád j. č.; „ho“ beze změny
- `serverErrors.taskChangedMeanwhile`: Úkol se mezitím změnil — obrazovka byla obnovena → Mezitím se to změnilo — obrazovka byla obnovena — podstatné jméno vypuštěno („to“)
- `serverErrors.problemNoProperty`: Problém nemá objekt — nelze ho přidělit → Úkol nemá objekt — nelze ho přidělit — 1. pád j. č.
- `serverErrors.taskNotFound`: Úkol nenalezen → Úklid nenalezen — 1. pád j. č.
- `serverErrors.stepNotFound`: Krok nebyl nalezen nebo úkol již neprobíhá → Krok nebyl nalezen nebo úklid již neprobíhá — 1. pád j. č.
- `serverErrors.taskClosed`: Úkol je již uzavřen ({{status}}) → Úklid je již uzavřen ({{status}}) — 1. pád j. č.
- `serverErrors.taskDateRequired`: Úkol musí mít den → Úklid musí mít den — 1. pád j. č.
- `serverErrors.taskDuplicate`: Tento byt už na {{date}} takový úkol má → Tento byt už na {{date}} takový úklid má — 4. pád j. č.; „takový“ beze změny
- `serverErrors.taskMovedMeanwhile`: Zatímco byl formulář otevřený, úkol se přesunul na {{date}}. Otevřete ho znovu. → Zatímco byl formulář otevřený, úklid se přesunul na {{date}}. Otevřete ho znovu. — 1. pád j. č.; „ho“ beze změny

Doplněno podle rozhodnutí majitele (2026-09-27): „Hlášení“ na kartě objektu a „závada“ v popisku chatu → „úkol“.

- `panel.apartments.maintenance.reports`: Hlášení (otevřených: {{open}}) → Úkoly (otevřených: {{open}}) — 1. pád mn. č.
- `panel.apartments.maintenance.noReports`: Žádná hlášení. → Žádné úkoly. — 1. pád mn. č.
- `panel.chat.audienceProblem`: Vidí ti, kdo vidí závadu: kdo ji nahlásil, technik a manažeři → Vidí ti, kdo vidí úkol: kdo ho nahlásil, technik a manažeři — 4. pád j. č.; zájmeno ji → ho (úkol je mužského rodu)

Doplněno pro obrazovku „Nastavení“ v aplikaci uklízeček (F11, 2026-09-28). Nové texty, dříve neexistovaly. Každý řádek: klíč: text — poznámka, pokud je potřeba. Texty v {{složených závorkách}} se nepřekládají.

- `auth.forgotPassword`: Zapomněli jste heslo? Obraťte se na manažera.
- `settings.title`: Nastavení
- `settings.notifications.heading`: Oznámení
- `settings.notifications.hint`: Tyto přepínače určují, co vám bude server posílat.
- `settings.notifications.loading`: Načítáme…
- `settings.notifications.loadFailed`: Oznámení se nepodařilo načíst.
- `settings.notifications.saveFailed`: Volba se neuložila.
- `settings.notifications.kinds.cleaning_new`: Nový úklid
- `settings.notifications.kinds.cleaning_assigned`: Úklid přidělen vám — slovosled podle majitele („vám“ na konci zdůrazňuje komu)
- `settings.notifications.kinds.cleaning_unassigned`: Úklid vám byl odebrán — trpný rod: úklid byl odebrán
- `settings.notifications.kinds.cleaning_cancelled`: Úklid zrušen
- `settings.notifications.kinds.cleaning_moved`: Úklid přesunut
- `settings.notifications.kinds.cleaning_window`: Změnil se čas úklidu
- `settings.notifications.kinds.cleaning_free`: Volný úklid
- `settings.notifications.kinds.booking_cancelled_live`: Rezervace zrušena během úklidu — zrušena — ž. r. (rezervace); během úklidu — 2. pád j. č.
- `settings.notifications.kinds.chat_message`: Zpráva v chatu
- `settings.notifications.kinds.daily_digest`: Ranní přehled
- `settings.language.heading`: Jazyk
- `settings.language.saveFailed`: Jazyk se nepodařilo změnit.
- `settings.password.heading`: Heslo
- `settings.password.current`: Současné heslo
- `settings.password.new`: Nové heslo
- `settings.password.repeat`: Nové heslo znovu
- `settings.password.submit`: Změnit heslo
- `settings.password.fillAll`: Vyplňte všechna tři pole.
- `settings.password.mismatch`: Nová hesla se neshodují.
- `settings.password.tooShort`: Nové heslo musí mít alespoň {{min}} znaků. — {{min}} je vždy 6: „6 znaků“ — 2. pád mn. č.
- `settings.password.sameAsCurrent`: Nové heslo je stejné jako současné.
- `settings.password.wrongCurrent`: Současné heslo není správné.
- `settings.password.weak`: Heslo je příliš jednoduché. Zvolte jiné. — o hesle, které server odmítl jako příliš snadno uhodnutelné
- `settings.password.needsNetwork`: Ke změně hesla je potřeba připojení. Zkontrolujte internet a zkuste to znovu.
- `settings.password.changed`: Heslo je změněno. Na ostatních zařízeních se bude nutné znovu přihlásit.
- `settings.password.confirmAgain`: Přihlášení je potřeba znovu potvrdit. Klepněte ještě jednou na „Změnit heslo“. — server chce čerstvé přihlášení; druhé klepnutí ho dá
- `common.languages.ru`, `.en`, `.cs`: Русский, English, Čeština — beze změny, jen přesunuto z `panel.team.languages`; každý jazyk je napsán sám sebou

Doplněno pro tlačítko „Přijmout“ (F11, 2026-09-28). Nové texty. Uklízečka jím dává kanceláři najevo, že přidělený úklid udělá; začít úklid jde i bez něj.

- `tasks.accept`: Přijmout — tlačítko na kartě a na obrazovce úklidu
- `tasks.acceptAccessibility`: Přijmout: {{property}}, {{date}} — co přečte čtečka obrazovky
- `tasks.acceptFailedTitle`: Úklid se nepodařilo přijmout
- `tasks.acceptFailed`: Úklid se nepodařilo přijmout — mohl být předán jinému, přesunut nebo zrušen. — úklid mužského rodu: předán, přesunut, zrušen
- `tasks.status.accepted`: Přijato — štítek na kartě; platí pro úklid i práci, proto střední rod
- `tasks.detail.accepted`: Úklid přijat
- `tasks.work.accepted`: Práce přijata — pro opravy a kontroly

Doplněno pro texty push (F11, 2026-09-28). Nové texty; posílá je server v jazyce uklízečky, když je aplikace zavřená. {{place}} je objekt, {{date}} den („pá 2. 10.“), {{count}} počet, {{author}} jméno pisatele. Text zprávy se nikdy neukazuje.

- `push.cleaning_new.title`: Nový úklid
- `push.cleaning_new.titleWork`: Nová práce
- `push.cleaning_assigned.title`: Máte přidělený úklid
- `push.cleaning_assigned.titleWork`: Máte přidělenou práci
- `push.cleaning_unassigned.title`: Tento úklid už nemáte — úklid mužského rodu: „tento úklid“
- `push.cleaning_unassigned.titleWork`: Tuto práci už nemáte
- `push.cleaning_cancelled.title`: Úklid zrušen
- `push.cleaning_cancelled.titleWork`: Práce zrušena
- `push.cleaning_moved.title`: Úklid přesunut
- `push.cleaning_moved.titleWork`: Práce přesunuta
- `push.cleaning_moved.byOffice`: Přesunul manažer. — kdo úklid přesunul
- `push.cleaning_moved.byBooking`: Změnila se rezervace.
- `push.cleaning_window.title`: Změnil se čas úklidu
- `push.cleaning_window.titleWork`: Změnil se čas práce
- `push.cleaning_free.title`: Volný úklid
- `push.cleaning_free.titleWork`: Volná práce
- `push.booking_cancelled_live.title`: Rezervace zrušena
- `push.booking_cancelled_live.body`: {{place}}: rezervace byla zrušena během úklidu. Ověřte si to u manažera.
- `push.chat_message.title`: Nová zpráva
- `push.chat_message.count_one`: {{count}} nová zpráva
- `push.chat_message.count_few`: {{count}} nové zprávy — 2–4 zprávy
- `push.chat_message.count_many`: {{count}} nové zprávy
- `push.chat_message.count_other`: {{count}} nových zpráv — 5 a více zpráv
- `push.daily_digest.title`: Váš den
- `push.daily_digest.today`: Dnes: {{count}}
- `push.daily_digest.newInWeek`: Nových v týdnu: {{count}}
- `push.daily_digest.free`: Volných v týdnu: {{count}} — (2026-09-29, ночью, по
  образцу строки выше; носителю проверить обе: «v týdnu» может читаться как «в
  будни», а «volných» без слова — как «выходных»; вариант — «Volné úklidy v
  týdnu: {{count}}»)
- `push.placeDay`: {{place}}, {{date}}
- `push.moveDays`: {{place}}: {{from}} → {{to}}
- `push.movePlaces`: {{from}} → {{to}}, {{date}}
- `push.moveBoth`: {{fromPlace}}, {{fromDate}} → {{toPlace}}, {{toDate}}
- `push.windowBody`: {{place}}, {{date}}: {{window}}
- `push.windowRange`: {{from}}–{{to}}
- `push.windowFrom`: od {{time}}
- `push.windowUntil`: do {{time}}
- `push.messageFrom`: {{place}} · {{author}}
- `push.unknownPlace`: Objekt {{id}}

Doplněno pro oznámení v telefonu (F11, sestavení 1.1.0, 2026-09-28). Nové texty. Kanály jsou kategorie oznámení, které Android ukazuje v nastavení aplikace; úvodní obrazovka se objeví před systémovým dotazem na povolení; poznámka nad seznamem úklidů se ukáže po klepnutí na oznámení o úklidu, který už není její.

- `settings.notifications.channels.urgent`: Naléhavá oznámení — název kanálu v nastavení Androidu
- `settings.notifications.channels.general`: Ostatní oznámení — název kanálu v nastavení Androidu
- `settings.notifications.permission.notAsked`: Telefon zatím aplikaci nepovolil posílat oznámení.
- `settings.notifications.permission.off`: Oznámení jsou vypnutá v nastavení telefonu. Bez nich se nedozvíte o nových úklidech a zprávách.
- `settings.notifications.permission.channelOff`: V nastavení telefonu jsou vypnutá „{{channel}}“. — {{channel}} je název kanálu výše
- `settings.notifications.permission.provisional`: Oznámení chodí potichu, jen do Centra oznámení. Zvuk a bannery se zapínají v nastavení telefonu. — jen iPhone
- `settings.notifications.permission.enable`: Zapnout oznámení
- `settings.notifications.permission.openSettings`: Otevřít nastavení telefonu
- `notifications.intro.title`: Oznámení — nadpis obrazovky
- `notifications.intro.heading`: Nezmeškejte úklid
- `notifications.intro.body`: Aplikace vám dá vědět, když vám přidělí úklid, přesunou ho nebo zruší a když vám někdo odpoví v chatu. Text zprávy se v oznámení nikdy neukazuje.
- `notifications.intro.allow`: Povolit oznámení
- `notifications.intro.later`: Teď ne
- `notifications.intro.settingsHint`: Pokud si to rozmyslíte, najdete to v Nastavení.
- `notifications.intro.failed`: Oznámení se nepodařilo zapnout.
- `tasks.pushNotice.unassigned`: Tento úklid vám byl odebrán.
- `tasks.pushNotice.cancelled`: Tento úklid byl zrušen.
- `tasks.pushNotice.movedAway`: Úklid byl přesunut a teď ve vašem seznamu není.
- `tasks.pushNotice.dismiss`: Skrýt

Doplněno pro systémové dotazy iPhonu na fotoaparát, mikrofon a galerii (sestavení 1.1.0, 2026-10-01). Texty čte i technik, proto mluví o „práci“, ne o úklidu; aplikace nově natáčí video vlastním fotoaparátem. Každý řádek: klíč: bylo → bude — poznámka.

- `iosPermissions.camera`: Aplikace fotoaparátem fotí byt před úklidem a po něm. → Aplikace fotoaparátem pořizuje fotky a videa práce — před ní a po ní. — „před ní a po ní“ = před prací a po práci
- `iosPermissions.microphone`: Aplikace nahrává zvuk k videu z úklidu. → Aplikace nahrává zvuk k videím z práce. — 3. pád mn. č.
- `iosPermissions.photos`: Aplikace připojí fotky, které vyberete v galerii, ke krokům úklidu, úkolům a zprávám v chatu. → Aplikace připojí fotky, které vyberete v galerii, ke krokům checklistu, úkolům a zprávám v chatu. — „checklist“ jako jinde v aplikaci; jde-li lépe „kontrolního seznamu“, prosíme napsat
