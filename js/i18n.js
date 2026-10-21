// i18n.js — English / Russian texts. t(key, params) returns the text in the current language.
// Static HTML texts carry data-i18n (text), data-i18n-html (markup), data-i18n-aria (aria-label) attributes
// and are filled by applyStatic(). Works without a DOM (unit tests run in English).

const ruPlural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
};
const enPlural = (n, one, many) => (n === 1 ? one : many);

const EN = {
  'lang.choose': 'Choose your language',
  // camera screen
  'cam.starting': 'Starting camera…', 'cam.ready': 'Ready', 'cam.unavailable': 'Camera unavailable', 'cam.stopped': 'Camera stopped',
  'cam.stoppedMsg': 'The camera stopped (it may have been taken by another app).',
  'cam.rec': (p) => `● REC ${p.s} s · ${p.n} ${enPlural(p.n, 'frame', 'frames')}`,
  'cam.countdown': 'Countdown — tap ■ to cancel',
  'cam.lowStorage': 'There is very little free storage on this phone. Free some space and try again.',
  'cam.noSensor': 'This phone/browser has no motion sensor access, so the level is not available.',
  'cam.sensorDenied': 'Motion sensor access was not allowed, so the level is not available. (Recording works without it.)',
  'cam.frames': 'Frames', 'cam.retry': 'Try again', 'cam.interval': 'Interval', 'u.s': 's', 'cam.zoom': 'Zoom', 'cam.zoomAria': 'Camera zoom',
  'cam.countdownLbl': 'Countdown', 'cam.off': 'Off', 'cam.level': 'Level', 'cam.settings': 'Settings', 'cam.exposure': 'Exposure',
  'cam.expAuto': 'Automatic',
  'cam.expNote': 'A short exposure reduces motion blur but darkens the picture; use bright light.',
  'cam.expTip': 'For moving objects use bright light: the camera then chooses a shorter exposure (less motion blur). A high frame rate alone does not guarantee short exposures.',
  'cam.zoomNote': 'Zoom uses the camera’s own zoom. Beyond the lens’s optical range it is digital (it crops the picture and adds no detail). Keep zoom and phone position unchanged between calibration and measurement.',
  'cam.version': 'App version', 'cam.start': 'Start', 'cam.stop': 'Stop', 'cam.cancelCd': 'Cancel countdown',
  'cam.confirmAgain': 'Starting a new recording deletes the frames shown here. Continue?',
  'cam.confirmFinish': 'Delete all frames of this experiment? This cannot be undone.',
  // camera errors
  'err.insecure': 'The camera only works on a secure (https://) address.',
  'err.unsupported': 'This browser cannot use the camera. Use Safari on iPhone or Chrome on Android.',
  'err.denied': 'Camera permission was denied. Allow camera access for this site in the browser settings, then tap “Try again”.',
  'err.none': 'No camera was found on this device.',
  'err.busy': 'The camera could not be started. Close other apps that use the camera and tap “Try again”.',
  'err.unknown': 'The camera could not be started. Tap “Try again”.',
  'err.noTimestamps': 'Frame timestamps are not available in this browser.',
  'err.oldBrowser': 'This browser is too old to provide video frame timing. Update Safari/Chrome.',
  'err.storageFull': 'The phone is out of storage space. Free some space (delete photos/apps), then record again.',
  'err.storage': 'The phone could not save the images (browser storage problem). Do not use private browsing mode.',
  // timing checks
  'q.tooFew': 'Too few frames were captured. Record again.',
  'q.bad': (p) => `${p.bad} of ${p.n} frames have unreliable timing (marked with a warning). Repeat the experiment before using these times for calculations.`,
  'q.nonMono': (p) => `${p.n} camera frame(s) had invalid timestamps and were ignored.`,
  'q.rate': (p) => `Camera delivered about ${p.fps} frames/s (median ${p.med} ms between frames).`,
  'q.quant': (p) => `With this frame rate a timing error of up to ±${p.q} ms is unavoidable; the tolerance (±${p.tol} ms) is stricter than the camera can guarantee.`,
  'q.slow': 'The camera is slow (low frame rate, often in dim light) compared with the allowed timing error, so frames may miss their target. Better lighting or a larger interval helps.',
  'q.align': (p) => `The interval (${p.iv} s) is ${p.n} camera frames long, not a whole number, so the kept frames alternate between earlier and later than their target (up to ±${p.half} ms). Intervals that fit this camera: ${p.lo} s or ${p.hi} s.`,
  'q.dropped': (p) => `About ${p.n} camera frame(s) were dropped during the recording (kept images next to a gap are marked).`,
  'q.unstable': (p) => `The camera frame rate was unstable (${p.pct} % of frame intervals differ by more than 25 % from the typical one). Better lighting usually helps.`,
  'q.line': (p) => `Frame ${p.i} | Target: ${p.target} s | Actual: ${p.actual} s | Deviation: ${p.dev}`,
  'u.ms': 'ms', 'u.fps': 'fps',
  // gallery
  'g.title': 'Experiment frames', 'g.info': 'Video information',
  'g.tip': 'Tip: open a frame and tap <b>● A</b> (red) or <b>● B</b> (blue), then touch the object; a magnifier shows the exact spot and the arrows move the point by one image pixel. Mark one colour for a simple t, x, y table; mark both on the same frames for <b>Plot Y(X)</b> and the centre of mass.',
  'g.measurements': 'Measurements', 'g.csv': 'Export CSV', 'g.coords': 'Scale & vertical (coordinate system)',
  'g.setScale': 'Set scale…', 'g.changeScale': 'Change scale…', 'g.removeScale': 'Remove scale',
  'g.setVert': 'Set vertical…', 'g.changeVert': 'Change vertical…', 'g.removeVert': 'Remove vertical',
  'g.persp': 'A two-point scale does not correct perspective or lens distortion: keep the ruler in the plane of the motion and the camera square to it. If the zoom or the phone position changed, set the scale again.',
  'g.timingTable': 'Timing table (all frames)', 'g.again': 'Record again', 'g.plot': 'Plot Y(X)', 'g.finish': 'Finish & clear data',
  'g.sub': (p) => `${p.when} · every ${p.iv} s · ${p.n} ${enPlural(p.n, 'frame', 'frames')}`,
  'g.passed': (p) => `Timing check passed: all frames within ±${p.tol} ms (10 % of the interval) of their target time (worst ${p.worst} ms).`,
  'g.failed': 'Timing check failed — repeat the experiment', 'g.noFrames': 'No frames were captured.',
  'flag.deviation': 'timing off target', 'flag.gap': 'camera frames were dropped nearby',
  'flag.duplicate': 'same camera frame as the previous image', 'flag.suspect': 'late callback: pixels may belong to a neighbouring frame',
  'stop.hidden': 'Recording was interrupted because the app went to the background or the screen turned off.',
  'stop.track-ended': 'The camera stopped during recording (disconnected, or taken by another app).',
  'stop.orientation': 'The phone was rotated during recording, which changes the image size.',
  'stop.storage': 'The phone ran out of storage space or could not save images.',
  'stop.overload': 'The phone could not keep up with saving the images (too slow). Try a longer interval.',
  'stop.reload': 'The page was closed or reloaded during recording.',
  'n.camMode': (p) => `Camera mode reported by the browser: ${p.w}×${p.h}${p.fps ? ` at ${p.fps} fps nominal` : ''}${p.zoom ? `, zoom ${p.zoom}×` : ''}. The measured rate above is what counts.`,
  'n.tsSource': (p) => `Timestamp source: ${p.src}.`,
  'ts.processor': 'VideoFrame.timestamp (camera capture clock)', 'ts.capture': 'requestVideoFrameCallback captureTime',
  'ts.presentation': 'requestVideoFrameCallback presentationTime (compatibility mode)',
  'n.compat': 'Compatibility mode: this browser reports frame times less precisely than Chrome on Android. Treat small time differences with caution.',
  'n.pipeline': 'Times are camera-pipeline timestamps, not sensor exposure times: expect an uncertainty of about one camera frame period.',
  'g.tileAria': (p) => `Frame ${p.i}, ${p.t} seconds`,
  'pt.a': 'Point A (red)', 'pt.b': 'Point B (blue)', 'pt.cm': 'Centre of mass (green)',
  'm.none': 'No points marked yet. Open a frame and mark Point A (red) and/or Point B (blue).',
  'm.single': (p) => `Single-point measurement: ${p.pt} on ${p.n} ${enPlural(p.n, 'frame', 'frames')}. Plot Y(X) and the centre of mass need both points marked on the same frames.`,
  'm.unpaired': (p) => `Both points are marked (A on ${p.a}, B on ${p.b} frames) but never on the same frame. Mark A and B on the same frames to enable Plot Y(X).`,
  'm.two': (p) => `Two-point measurement: A on ${p.a}, B on ${p.b} ${enPlural(p.b, 'frame', 'frames')}, both on ${p.both}.`,
  'm.masses': (p) => ` Masses m_red = ${p.ma} g, m_blue = ${p.mb} g: centre of mass (green) on the ${p.both} ${enPlural(p.both, 'frame', 'frames')} with both points.`,
  'm.noMasses': ' Tap Plot Y(X) to plot the trajectories; you can add masses there for the centre of mass.',
  'm.saveErr': 'Could not save: ',
  'c.origin': 'Origin: bottom-left corner of the picture, x to the right, y up',
  'c.rot': (p) => `axes rotated by ${p.deg}° so that y points along the ${p.sensor ? 'vertical measured by the phone’s level at the start of recording' : 'vertical reference you marked'}`,
  'c.noRot': 'picture edges taken as horizontal/vertical (no vertical reference set)',
  'c.scale': (p) => `scale: 1 ${p.px} = ${p.s} ${p.unit} (${p.d} ${p.dunit} between two marked points)`,
  'c.noScale': 'units: image pixels (no scale set)',
  'c.sensorBtn': (p) => `Use phone level (${p.deg}°)`,
  'u.px': 'px', 'u.mm': 'mm', 'u.cm': 'cm', 'u.m': 'm', 'u.g': 'g',
  'col.t': 't (s)', 'col.x': 'x', 'col.y': 'y', 'col.xa': 'x red', 'col.ya': 'y red', 'col.xb': 'x blue', 'col.yb': 'y blue', 'col.xcm': 'x CoM', 'col.ycm': 'y CoM',
  // viewer
  'v.close': 'Close', 'v.save': 'Save', 'v.saveAria': 'Save image', 'v.distance': 'Distance', 'v.cancel': 'Cancel',
  'v.left': 'Move left one pixel', 'v.up': 'Move up one pixel', 'v.down': 'Move down one pixel', 'v.right': 'Move right one pixel',
  'v.clear': 'Clear', 'v.fit': 'Fit', 'v.delete': 'Delete', 'v.prev': 'Previous frame', 'v.next': 'Next frame',
  'v.title': (p) => `Frame ${p.i} (${p.k} of ${p.n})`,
  'v.line': (p) => `t = ${p.t} s · target ${p.target} s · ${p.dev}`,
  'v.loadErr': 'This image could not be loaded.',
  'v.done': '✓ done', 'v.move': '(move)', 'v.noPoint': 'no point yet',
  'v.editing': (p) => `Editing point ${p.k} ⇄`,
  'v.hintCal': 'Touch two marks on the ruler (point 1, then point 2), enter their distance, Save.',
  'v.hintVert': 'Touch two points on something truly vertical (plumb line, door frame), then Save.',
  'v.hintMark': (p) => `Tap to mark ${p.pt}, or slide to fine-tune with the magnifier. Two fingers zoom/move.`,
  'v.hintIdle': 'To mark a point: tap ● A (red) or ● B (blue) below, then tap the object.',
  'v.count': (p) => `A: ${p.a} · B: ${p.b} of ${p.n}`,
  'v.markErr': 'Could not save the mark: ', 'v.bothFirst': 'Place both points first.', 'v.tooClose': 'The two points are too close together.',
  'v.distErr': 'Enter the real distance between the two points (greater than 0).',
  'v.deleted': (p) => `Frame ${p.i} deleted.`, 'v.undo': 'Undo', 'v.restoreErr': 'Could not restore: ', 'v.deleteErr': 'Could not delete: ',
  // plot
  'p.title': 'Plot Y(X)', 'p.saveAria': 'Save plot as image',
  'p.massIntro': 'Masses at the two points (optional). With both masses the centre of mass is calculated and plotted in green. Only their ratio matters.',
  'p.skip': 'Skip — plot red & blue', 'p.withMasses': 'Plot with masses', 'p.masses': 'Masses…',
  'p.massErr': 'Enter two masses greater than 0 (or tap Skip).',
  'p.chartTitle': 'Plot Y(X) — measured positions',
  'p.points': (p) => `${p.n} ${enPlural(p.n, 'point', 'points')}`,
  'p.few': (p) => `${p.label}: only ${p.n} marked frame — mark more frames to see a trajectory.`,
  'p.cm': (p) => `Centre of mass for the ${p.n} frame(s) that have both points, with m_red = ${p.ma} g and m_blue = ${p.mb} g. Frames with only one point have no centre of mass. Nothing is fitted: the green path comes straight from your marks.`,
  'p.noCm': 'No masses entered, so no centre of mass is shown. Tap “Masses…” to add them.',
  'p.lines': 'Lines join the points in time order. A dashed line means frames in between have no mark for that point (nothing is filled in).',
  'p.px': 'Coordinates are image pixels (origin bottom-left, y up). Set a scale in the gallery to get millimetres or metres.',
  'p.units': (p) => `Coordinates in ${p.unit} using your scale (origin bottom-left of the picture, y up).`,
  'p.timing': 'Warning: the timing check of this recording failed, so the time order of points may be unreliable.',
  'js.required': 'This app needs JavaScript.',
};

const RU = {
  'lang.choose': 'Выберите язык',
  'cam.starting': 'Запуск камеры…', 'cam.ready': 'Готово', 'cam.unavailable': 'Камера недоступна', 'cam.stopped': 'Камера остановлена',
  'cam.stoppedMsg': 'Камера остановилась (возможно, её заняло другое приложение).',
  'cam.rec': (p) => `● ЗАПИСЬ ${p.s} с · ${p.n} ${ruPlural(p.n, 'кадр', 'кадра', 'кадров')}`,
  'cam.countdown': 'Обратный отсчёт — нажмите ■ для отмены',
  'cam.lowStorage': 'На телефоне очень мало свободной памяти. Освободите место и попробуйте снова.',
  'cam.noSensor': 'Этот телефон или браузер не даёт доступа к датчику движения, поэтому уровень недоступен.',
  'cam.sensorDenied': 'Доступ к датчику движения не разрешён, поэтому уровень недоступен. (Запись работает и без него.)',
  'cam.frames': 'Кадры', 'cam.retry': 'Повторить', 'cam.interval': 'Интервал', 'u.s': 'с', 'cam.zoom': 'Зум', 'cam.zoomAria': 'Зум камеры',
  'cam.countdownLbl': 'Отсчёт', 'cam.off': 'Выкл.', 'cam.level': 'Уровень', 'cam.settings': 'Настройки', 'cam.exposure': 'Выдержка',
  'cam.expAuto': 'Автоматически',
  'cam.expNote': 'Короткая выдержка уменьшает смазывание, но делает снимок темнее; нужен яркий свет.',
  'cam.expTip': 'Для движущихся предметов нужен яркий свет: тогда камера сама выбирает более короткую выдержку (меньше смазывание). Высокая частота кадров сама по себе короткую выдержку не гарантирует.',
  'cam.zoomNote': 'Используется собственный зум камеры. За пределами оптического диапазона объектива он цифровой (обрезает кадр и не добавляет деталей). Не меняйте зум и положение телефона между калибровкой и измерением.',
  'cam.version': 'Версия приложения', 'cam.start': 'Старт', 'cam.stop': 'Стоп', 'cam.cancelCd': 'Отменить отсчёт',
  'cam.confirmAgain': 'Новая запись удалит показанные здесь кадры. Продолжить?',
  'cam.confirmFinish': 'Удалить все кадры этого эксперимента? Отменить это будет нельзя.',
  'err.insecure': 'Камера работает только на защищённом адресе (https://).',
  'err.unsupported': 'Этот браузер не может использовать камеру. Используйте Safari на iPhone или Chrome на Android.',
  'err.denied': 'Доступ к камере запрещён. Разрешите камеру для этого сайта в настройках браузера и нажмите «Повторить».',
  'err.none': 'На этом устройстве не найдена камера.',
  'err.busy': 'Не удалось запустить камеру. Закройте другие приложения, использующие камеру, и нажмите «Повторить».',
  'err.unknown': 'Не удалось запустить камеру. Нажмите «Повторить».',
  'err.noTimestamps': 'В этом браузере недоступны метки времени кадров.',
  'err.oldBrowser': 'Этот браузер слишком старый и не сообщает время кадров. Обновите Safari или Chrome.',
  'err.storageFull': 'На телефоне закончилась память. Освободите место (удалите фото или приложения) и запишите снова.',
  'err.storage': 'Телефон не смог сохранить снимки (проблема с хранилищем браузера). Не используйте режим «Частный доступ» / инкогнито.',
  'q.tooFew': 'Записано слишком мало кадров. Запишите снова.',
  'q.bad': (p) => `У ${p.bad} из ${p.n} кадров ненадёжное время (отмечены предупреждением). Повторите эксперимент, прежде чем использовать эти значения времени в расчётах.`,
  'q.nonMono': (p) => `Кадров камеры с неверной меткой времени: ${p.n}. Они пропущены.`,
  'q.rate': (p) => `Камера выдавала около ${p.fps} кадр/с (медиана ${p.med} мс между кадрами).`,
  'q.quant': (p) => `При такой частоте кадров ошибка времени до ±${p.q} мс неизбежна; допуск (±${p.tol} мс) строже, чем может обеспечить камера.`,
  'q.slow': 'Камера работает медленно (низкая частота кадров, часто при слабом освещении) по сравнению с допустимой ошибкой времени, поэтому кадры могут не попадать в целевое время. Поможет более яркий свет или больший интервал.',
  'q.align': (p) => `Интервал (${p.iv} с) равен ${p.n} периода кадров камеры — не целому числу, поэтому сохранённые кадры попеременно оказываются раньше и позже целевого времени (до ±${p.half} мс). Интервалы, подходящие для этой камеры: ${p.lo} с или ${p.hi} с.`,
  'q.dropped': (p) => `Во время записи пропущено примерно ${p.n} ${ruPlural(p.n, 'кадр', 'кадра', 'кадров')} камеры (снимки рядом с пропуском отмечены).`,
  'q.unstable': (p) => `Частота кадров камеры была нестабильной (${p.pct} % интервалов между кадрами отличаются от обычного более чем на 25 %). Обычно помогает более яркий свет.`,
  'q.line': (p) => `Кадр ${p.i} | Цель: ${p.target} с | Факт: ${p.actual} с | Отклонение: ${p.dev}`,
  'u.ms': 'мс', 'u.fps': 'кадр/с',
  'g.title': 'Кадры эксперимента', 'g.info': 'Сведения о видео',
  'g.tip': 'Совет: откройте кадр, нажмите <b>● A</b> (красная) или <b>● B</b> (синяя) и коснитесь предмета; лупа покажет точное место, а стрелки сдвигают точку на один пиксель снимка. Отметьте точки одного цвета — получите простую таблицу t, x, y; отметьте обе точки на одних и тех же кадрах — станут доступны <b>График Y(X)</b> и центр масс.',
  'g.measurements': 'Измерения', 'g.csv': 'Экспорт CSV', 'g.coords': 'Масштаб и вертикаль (система координат)',
  'g.setScale': 'Задать масштаб…', 'g.changeScale': 'Изменить масштаб…', 'g.removeScale': 'Удалить масштаб',
  'g.setVert': 'Задать вертикаль…', 'g.changeVert': 'Изменить вертикаль…', 'g.removeVert': 'Удалить вертикаль',
  'g.persp': 'Масштаб по двум точкам не исправляет перспективу и искажения объектива: линейка должна лежать в плоскости движения, а камера — смотреть на неё прямо. Если изменился зум или положение телефона, задайте масштаб заново.',
  'g.timingTable': 'Таблица времени (все кадры)', 'g.again': 'Записать снова', 'g.plot': 'График Y(X)', 'g.finish': 'Завершить и удалить данные',
  'g.sub': (p) => `${p.when} · каждые ${p.iv} с · ${p.n} ${ruPlural(p.n, 'кадр', 'кадра', 'кадров')}`,
  'g.passed': (p) => `Проверка времени пройдена: все кадры в пределах ±${p.tol} мс (10 % интервала) от целевого времени (наибольшее отклонение ${p.worst} мс).`,
  'g.failed': 'Проверка времени не пройдена — повторите эксперимент', 'g.noFrames': 'Кадры не записаны.',
  'flag.deviation': 'время не совпадает с целевым', 'flag.gap': 'рядом пропущены кадры камеры',
  'flag.duplicate': 'тот же кадр камеры, что и на предыдущем снимке', 'flag.suspect': 'запоздалый вызов: снимок может относиться к соседнему кадру',
  'stop.hidden': 'Запись прервана: приложение ушло в фон или экран выключился.',
  'stop.track-ended': 'Камера остановилась во время записи (отключилась или её заняло другое приложение).',
  'stop.orientation': 'Телефон повернули во время записи, из-за этого изменился размер изображения.',
  'stop.storage': 'На телефоне закончилась память или не удалось сохранить снимки.',
  'stop.overload': 'Телефон не успевал сохранять снимки (слишком медленно). Попробуйте больший интервал.',
  'stop.reload': 'Страницу закрыли или перезагрузили во время записи.',
  'n.camMode': (p) => `Режим камеры по данным браузера: ${p.w}×${p.h}${p.fps ? `, номинально ${p.fps} кадр/с` : ''}${p.zoom ? `, зум ${p.zoom}×` : ''}. Значение имеет измеренная частота (выше).`,
  'n.tsSource': (p) => `Источник меток времени: ${p.src}.`,
  'ts.processor': 'VideoFrame.timestamp (часы захвата камеры)', 'ts.capture': 'requestVideoFrameCallback captureTime',
  'ts.presentation': 'requestVideoFrameCallback presentationTime (режим совместимости)',
  'n.compat': 'Режим совместимости: этот браузер сообщает время кадров менее точно, чем Chrome на Android. К небольшим разницам во времени относитесь осторожно.',
  'n.pipeline': 'Время берётся из конвейера обработки видео, а не момента экспозиции матрицы: погрешность — примерно один период кадров камеры.',
  'g.tileAria': (p) => `Кадр ${p.i}, ${p.t} с`,
  'pt.a': 'Точка A (красная)', 'pt.b': 'Точка B (синяя)', 'pt.cm': 'Центр масс (зелёный)',
  'm.none': 'Точки ещё не отмечены. Откройте кадр и отметьте точку A (красную) и/или точку B (синюю).',
  'm.single': (p) => `Измерение одной точки: ${p.pt} отмечена на ${p.n} ${ruPlural(p.n, 'кадре', 'кадрах', 'кадрах')}. Для графика Y(X) и центра масс нужно отметить обе точки на одних и тех же кадрах.`,
  'm.unpaired': (p) => `Отмечены обе точки (A — на ${p.a}, B — на ${p.b} ${ruPlural(p.b, 'кадре', 'кадрах', 'кадрах')}), но ни разу на одном кадре. Отметьте A и B на одних и тех же кадрах, чтобы открыть график Y(X).`,
  'm.two': (p) => `Измерение двух точек: A — на ${p.a}, B — на ${p.b} ${ruPlural(p.b, 'кадре', 'кадрах', 'кадрах')}, обе — на ${p.both}.`,
  'm.masses': (p) => ` Массы m_red = ${p.ma} г, m_blue = ${p.mb} г: центр масс (зелёный) на ${p.both} ${ruPlural(p.both, 'кадре', 'кадрах', 'кадрах')} с обеими точками.`,
  'm.noMasses': ' Нажмите «График Y(X)», чтобы построить траектории; там же можно ввести массы для центра масс.',
  'm.saveErr': 'Не удалось сохранить: ',
  'c.origin': 'Начало координат: левый нижний угол снимка, ось x — вправо, ось y — вверх',
  'c.rot': (p) => `оси повёрнуты на ${p.deg}°, чтобы ось y шла вдоль ${p.sensor ? 'вертикали, измеренной уровнем телефона в начале записи' : 'отмеченной вами вертикали'}`,
  'c.noRot': 'края снимка считаются горизонталью и вертикалью (вертикаль не задана)',
  'c.scale': (p) => `масштаб: 1 ${p.px} = ${p.s} ${p.unit} (${p.d} ${p.dunit} между двумя отмеченными точками)`,
  'c.noScale': 'единицы: пиксели снимка (масштаб не задан)',
  'c.sensorBtn': (p) => `По уровню телефона (${p.deg}°)`,
  'u.px': 'пикс', 'u.mm': 'мм', 'u.cm': 'см', 'u.m': 'м', 'u.g': 'г',
  'col.t': 't (с)', 'col.x': 'x', 'col.y': 'y', 'col.xa': 'x крас.', 'col.ya': 'y крас.', 'col.xb': 'x син.', 'col.yb': 'y син.', 'col.xcm': 'x ц.м.', 'col.ycm': 'y ц.м.',
  'v.close': 'Закрыть', 'v.save': 'Сохранить', 'v.saveAria': 'Сохранить снимок', 'v.distance': 'Расстояние', 'v.cancel': 'Отмена',
  'v.left': 'Сдвинуть влево на один пиксель', 'v.up': 'Сдвинуть вверх на один пиксель', 'v.down': 'Сдвинуть вниз на один пиксель', 'v.right': 'Сдвинуть вправо на один пиксель',
  'v.clear': 'Стереть', 'v.fit': 'По размеру', 'v.delete': 'Удалить', 'v.prev': 'Предыдущий кадр', 'v.next': 'Следующий кадр',
  'v.title': (p) => `Кадр ${p.i} (${p.k} из ${p.n})`,
  'v.line': (p) => `t = ${p.t} с · цель ${p.target} с · ${p.dev}`,
  'v.loadErr': 'Не удалось загрузить этот снимок.',
  'v.done': '✓ готово', 'v.move': '(сдвинуть)', 'v.noPoint': 'точки пока нет',
  'v.editing': (p) => `Правка точки ${p.k} ⇄`,
  'v.hintCal': 'Коснитесь двух делений линейки (точка 1, затем точка 2), введите расстояние между ними и нажмите «Сохранить».',
  'v.hintVert': 'Коснитесь двух точек на чём-то строго вертикальном (отвес, дверной косяк) и нажмите «Сохранить».',
  'v.hintMark': (p) => `${p.pt}: нажмите на предмет, чтобы поставить точку, или ведите пальцем для точной подстройки по лупе. Двумя пальцами — масштаб и сдвиг.`,
  'v.hintIdle': 'Чтобы отметить точку: нажмите ● A (красная) или ● B (синяя) внизу, затем коснитесь предмета.',
  'v.count': (p) => `A: ${p.a} · B: ${p.b} из ${p.n}`,
  'v.markErr': 'Не удалось сохранить отметку: ', 'v.bothFirst': 'Сначала поставьте обе точки.', 'v.tooClose': 'Точки расположены слишком близко друг к другу.',
  'v.distErr': 'Введите реальное расстояние между двумя точками (больше 0).',
  'v.deleted': (p) => `Кадр ${p.i} удалён.`, 'v.undo': 'Отменить', 'v.restoreErr': 'Не удалось восстановить: ', 'v.deleteErr': 'Не удалось удалить: ',
  'p.title': 'График Y(X)', 'p.saveAria': 'Сохранить график как изображение',
  'p.massIntro': 'Массы в двух точках (необязательно). Если указать обе массы, будет рассчитан и показан зелёным центр масс. Важно только их отношение.',
  'p.skip': 'Пропустить — только красная и синяя', 'p.withMasses': 'Построить с массами', 'p.masses': 'Массы…',
  'p.massErr': 'Введите две массы больше 0 (или нажмите «Пропустить»).',
  'p.chartTitle': 'График Y(X) — измеренные положения',
  'p.points': (p) => `${p.n} ${ruPlural(p.n, 'точка', 'точки', 'точек')}`,
  'p.few': (p) => `${p.label}: отмечен только ${p.n} кадр — отметьте больше кадров, чтобы увидеть траекторию.`,
  'p.cm': (p) => `Центр масс рассчитан для кадров с обеими точками (${p.n}), m_red = ${p.ma} г, m_blue = ${p.mb} г. Для кадров с одной точкой центр масс не считается. Ничего не подгоняется: зелёная линия получена прямо из ваших отметок.`,
  'p.noCm': 'Массы не введены, поэтому центр масс не показан. Нажмите «Массы…», чтобы их добавить.',
  'p.lines': 'Линии соединяют точки по времени. Пунктир означает, что на кадрах между ними эта точка не отмечена (ничего не достраивается).',
  'p.px': 'Координаты — в пикселях снимка (начало — левый нижний угол, y вверх). Задайте масштаб в галерее, чтобы получить миллиметры или метры.',
  'p.units': (p) => `Координаты в ${p.unit} по вашему масштабу (начало — левый нижний угол снимка, y вверх).`,
  'p.timing': 'Внимание: проверка времени этой записи не пройдена, поэтому порядок точек по времени может быть ненадёжным.',
  'js.required': 'Для работы приложения нужен JavaScript.',
};

const DICT = { en: EN, ru: RU };
export const LANGS = ['en', 'ru'];
const KEY = 'physlab.lang';
const store = {
  get() { try { return typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null; } catch (_) { return null; } },
  set(v) { try { localStorage.setItem(KEY, v); } catch (_) {} },
};
const guess = () => (typeof navigator !== 'undefined' && /^ru\b/i.test(navigator.language || '') ? 'ru' : 'en');
let lang = LANGS.includes(store.get()) ? store.get() : guess();
const listeners = [];

export const getLang = () => lang;
/** true once the student picked a language (the first-launch question is then not shown again) */
export const hasChosen = () => LANGS.includes(store.get());
export function setLang(l) {
  if (!LANGS.includes(l)) return;
  store.set(l);
  if (l === lang) return;
  lang = l;
  applyStatic();
  for (const fn of listeners) { try { fn(l); } catch (_) {} }
}
export const onLangChange = (fn) => listeners.push(fn);

export function t(key, p = {}) {
  const v = DICT[lang][key] ?? EN[key];
  if (v === undefined) return key;
  return typeof v === 'function' ? v(p) : v;
}

/** Fill all static texts of the page in the current language. */
export function applyStatic(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  if (root.documentElement) root.documentElement.lang = lang;
  for (const e of root.querySelectorAll('[data-i18n]')) e.textContent = t(e.dataset.i18n);
  for (const e of root.querySelectorAll('[data-i18n-html]')) e.innerHTML = t(e.dataset.i18nHtml);
  for (const e of root.querySelectorAll('[data-i18n-aria]')) e.setAttribute('aria-label', t(e.dataset.i18nAria));
}
