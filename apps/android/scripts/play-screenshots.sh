#!/bin/bash
# Takes the Google Play screenshots on a running emulator (CI: the android.yml screenshots job),
# against the development server on port 3300 seeded with seed-screenshots.ts.
# Needs TOKEN_it, TOKEN_en and TOKEN_es (the accounts giulia, emma and lucia).
set -euo pipefail
apk=apps/android/app/build/outputs/apk/debug/app-debug.apk
out=apps/android/fastlane/metadata/android
adb reverse tcp:3300 tcp:3300
adb install -r "$apk"
# A tidy status bar: 9:41, full battery, full signal, no notifications.
adb shell settings put global sysui_demo_allowed 1
demo() { adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }
demo enter
demo clock -e hhmm 0941
demo battery -e level 100 -e plugged false
demo network -e wifi show -e level 4 -e fully true
demo network -e mobile show -e datatype none -e level 4 -e fully true
demo notifications -e visible false

for locale in it-IT en-US es-ES; do
  lang=${locale%%-*}
  case $lang in
    it) token=$TOKEN_it search=fotografia ;;
    en) token=$TOKEN_en search=photo ;;
    es) token=$TOKEN_es search=fotos ;;
  esac
  dir="$out/$locale/images/phoneScreenshots"
  mkdir -p "$dir"
  adb shell cmd locale set-app-locales com.disbigle.app --locales "$locale"
  n=1
  for screen in home chat me search notifications messages compose; do
    adb shell am force-stop com.disbigle.app
    adb shell am start -W -n com.disbigle.app/.MainActivity \
      --es server http://localhost:3300 --es token "$token" --es screen "$screen" --es search "$search" >/dev/null
    sleep 8
    adb exec-out screencap -p > "$dir/$n-$screen.png"
    n=$((n + 1))
  done
done
ls -la "$out"/*/images/phoneScreenshots
