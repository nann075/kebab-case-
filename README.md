# kebab-case-

ブラウザで遊べるカードバトルローグライク。`index.html` を開くだけで動きます。

## ゲームバランスのテスト

`tools/playtest.js` は Playwright で実ゲームを自動操作し、各難易度の勝率・平均到達階を測定するツールです。

```
npm install
npm run playtest -- 30        # easy/normal/hard を各30回
npm run playtest -- 50 easy   # easy のみ50回
```

Claude Code では `/playtest-balance` スキル、または `game-balance-tester` サブエージェントから利用できます。
