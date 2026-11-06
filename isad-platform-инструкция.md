# ISAD Hub: запуск на Windows и GitHub

Обновлено 3 ноября 2026 года. https://github.com/emergreq/isad-platform

## Что подготовлено

Проект: %USERPROFILE%\Desktop\isad-platform. Открывайте эту папку через «Открыть папку» в редакторе или Codex. Этот чат первоначально открыт для другой папки в Documents.

Копия обновлена до 304e84e (main). Это React + Vite (интерфейс), Node.js (API), PostgreSQL (база). Docker Compose поднимает приложение и базу вместе. Есть роли студента, старосты, преподавателя, координатора; занятия, ДЗ, посещаемость, пересдачи, материалы, проекты, Excel-выгрузка. Расписание читается из Google Sheets и публикуется координатором вручную. Данные демонстрационные. Отзывы, ML-лаборатория и ИИ-ассистент пока отсутствуют. Подробности — в README.md.

## Первый запуск

Откройте Docker Desktop и дождитесь запуска движка. В PowerShell:

```powershell
cd "$env:USERPROFILE\Desktop\isad-platform"
docker info
docker compose up --build -d
docker compose ps
docker compose logs --tail 60 app
```

Должны работать db и app, база — healthy. Миграции применяются автоматически. Только для новой пустой базы создайте демоданные:

```powershell
docker compose exec app npm run seed
```

Если база уже заполнена, повторный seed не нужен. Скрипт отказывается работать, если есть пользователи.

Откройте http://localhost:5173. API: http://localhost:3000 (запросам обычно нужен вход). PostgreSQL с Windows: localhost:55433, база/пользователь/пароль — isad; внутри Docker адрес db:5432.

Демоаккаунты: student@example.org (студент), headman@example.org (староста), teacher@example.org (преподаватель), coordinator@example.org (координатор), student2@example.org (другая группа). Общий пароль: [пароль хранится только локально].

## Следующие запуски

Из папки проекта, при работающем Docker Desktop:

```powershell
docker compose up -d
```

Остановка с сохранением данных:

```powershell
docker compose stop
```

Логи: `docker compose logs -f app`; Ctrl+C завершает просмотр логов.

База хранится отдельно от кода в Docker-томе pgdata. Git сохраняет код, а не введённые в интерфейсе данные. Не используйте `docker compose down -v`: команда удаляет том базы.

После обновления зависимостей, Dockerfile или получения новой версии кода:

```powershell
docker compose up --build -d --renew-anon-volumes app
```

Именованный том базы сохраняется. Новые миграции применятся при запуске. При правках интерфейс обновляется автоматически, API перезапускается через node --watch. Применённые миграции не редактируйте: добавляйте следующий файл в db/.

## Работа с ветками и merge

Проверьте `git status`. Незавершённые изменения сначала сохраните в своей ветке. Затем:

```powershell
git switch main
git pull --ff-only origin main
git switch -c codex/my-change
```

Для каждой задачи используйте новое имя ветки. После правок проверьте:

```powershell
docker compose exec app npm test
docker compose exec app npm run test:integration
docker compose exec app npm run build
git status
git diff
```

Добавьте только нужные файлы. Пример для интерфейса (пути замените на свои):

```powershell
git add client/src/main.jsx client/src/style.css
git diff --cached
git commit -m "Update interface"
git push -u origin codex/my-change
```

Не добавляйте .env, реальные пароли, node_modules, dist и копии базы. При первом push может потребоваться вход в GitHub в браузере. Git Credential Manager уже настроен. В рамках подготовки отправка кода на GitHub не выполнялась.

На GitHub: Pull requests → New pull request → base: main, compare: ваша ветка → просмотреть изменения → Create pull request → дождаться проверок, если настроены → Merge pull request / Squash and merge.

После merge:

```powershell
git switch main
git pull --ff-only origin main
```

Правки на сайте GitHub попадают на компьютер через pull. Локальные правки попадают на GitHub через commit и push. Если pull --ff-only отказался работать, не применяйте reset --hard или push --force наугад: сначала разберите конфликт.

## Что проверено

Установлены Git, Node.js 24.19.0 и npm 11.17.0. Зависимости проекта установлены через npm ci. `npm test`: 5 тестов прошли, интеграционный тест пропущен в обычном режиме. `npm run build`: сборка прошла. Эти проверки не заменяют проверку приложения с PostgreSQL.

На Windows интеграционный скрипт удобнее запускать в контейнере: в package.json используется Linux-синтаксис переменной окружения. npm сообщил о 9 moderate уязвимостях; README связывает их с транзитивными зависимостями ExcelJS. Принудительное обновление не выполнялось.

## Ошибка Docker sailor-ingest.sock

На компьютере обнаружен сбой Docker Desktop при доступе к временному сокету %LOCALAPPDATA%\Docker\run\sailor-ingest.sock. Ошибка возникает до запуска проекта. Не нажимайте Reset to factory defaults: это может удалить локальные данные Docker. Результат восстановления см. в сопроводительном сообщении.

Официальная документация: https://docs.docker.com/reference/cli/docker/compose/up/
Обсуждение аналогичной ошибки: https://github.com/docker/desktop-feedback/issues/554

Локальная настройка Windows: для этой копии установлено git config --local core.autocrlf input; три .sh-скрипта приведены к LF. Содержимое исходников относительно Git не изменилось. При новом клонировании проверьте, что shell-скрипты используют LF.


Итог проверки: Docker восстановлен без сброса, контейнеры работают, миграции применены, демоаккаунты созданы. Интеграционная проверка в отдельной временной базе: 10/10 тестов прошли. Повторно seed запускать не нужно.

Порт PostgreSQL 5433 занят другим процессом. Создан локальный compose.override.yaml с портом 55433; он исключён из Git через .git/info/exclude. При обычных командах docker compose этот файл подхватывается автоматически. Сохранены резервные копии временных каталогов Docker/run и docker-secrets-engine. При повторении socket-ошибки не делайте factory reset; ошибка требует отдельного восстановления Docker.
