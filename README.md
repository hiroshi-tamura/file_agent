# File Agent

高速ファイル操作APIサーバー with システムトレイ

## 概要

File Agentは、Webブラウザからローカルファイルシステムに高速でアクセスできるAPIサーバーです。
タスクトレイに常駐し、セキュアなトークン認証でファイル操作を提供します。

## 機能

- ✅ **ファイル検索** - パターンマッチングでサブフォルダ含む高速検索
- ✅ **ファイル削除** - ファイル・フォルダの削除
- ✅ **ファイル新規作成** - ファイル・フォルダの作成
- ✅ **ファイル移動** - ファイル・フォルダの移動
- ✅ **ファイルコピー** - ファイル・フォルダのコピー (再帰対応)
- ✅ **ファイル参照** - テキストファイル内容の読み込み
- ✅ **ディレクトリ一覧** - フォルダ内容の取得
- ✅ **ファイル書き込み** - テキストファイルへの書き込み
- ✅ **システムトレイ** - 右クリックメニューで設定・再起動・終了
- ✅ **設定ダイアログ** - GUI設定画面 (保存後自動再起動)

## インストール

1. リリースページから `file_agent.exe` をダウンロード
2. 任意のフォルダに配置
3. `icon.ico` を同じフォルダに配置 (オプション)
4. 実行

## 設定

設定は `file_agent.ini` ファイルで管理されます (実行ファイルと同じ場所):

```ini
[Settings]
port=8767
token=your-secure-token
```

### 設定変更方法

1. **GUI設定ダイアログ**: システムトレイアイコンを右クリック → 設定
2. **手動編集**: `file_agent.ini` を直接編集後、再起動

## API仕様

### 認証

全てのAPIリクエストには `token` パラメータが必要です。トークンはSHA256でハッシュ化されて検証されます。

### エンドポイント

#### 1. ヘルスチェック
```http
GET /api/health
```

#### 2. ファイル読み込み
```http
POST /api/read
Content-Type: application/json

{
  "path": "C:\\path\\to\\file.txt",
  "token": "your-token"
}
```

#### 3. ファイル書き込み
```http
POST /api/write
Content-Type: application/json

{
  "path": "C:\\path\\to\\file.txt",
  "content": "ファイル内容",
  "token": "your-token"
}
```

#### 4. ファイル削除
```http
POST /api/delete
Content-Type: application/json

{
  "path": "C:\\path\\to\\file.txt",
  "token": "your-token"
}
```

#### 5. ファイル検索
```http
POST /api/search
Content-Type: application/json

{
  "directory": "C:\\search\\dir",
  "pattern": "*.txt",
  "token": "your-token"
}
```

#### 6. ディレクトリ一覧
```http
GET /api/list?path=C:\\directory&token=your-token
```

#### 7. ファイル/フォルダ作成
```http
POST /api/create
Content-Type: application/json

{
  "path": "C:\\path\\to\\new\\file.txt",
  "is_directory": false,
  "token": "your-token"
}
```

#### 8. ファイル移動
```http
POST /api/move
Content-Type: application/json

{
  "source": "C:\\path\\to\\source.txt",
  "destination": "C:\\path\\to\\destination.txt",
  "token": "your-token"
}
```

#### 9. ファイルコピー
```http
POST /api/copy
Content-Type: application/json

{
  "source": "C:\\path\\to\\source.txt",
  "destination": "C:\\path\\to\\copy.txt",
  "token": "your-token"
}
```

### レスポンス形式

全てのAPIは以下の形式でレスポンスを返します:

```json
{
  "success": true,
  "data": "結果データ",
  "error": null
}
```

エラー時:
```json
{
  "success": false,
  "data": null,
  "error": "エラーメッセージ"
}
```

## JavaScript使用例

```javascript
const API_BASE = 'http://localhost:8767/api';
const API_TOKEN = 'your-token';

// ファイル読み込み
async function readFile(path) {
    const response = await fetch(`${API_BASE}/read`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({path, token: API_TOKEN})
    });
    const data = await response.json();
    
    if (data.success) {
        console.log('ファイル内容:', data.data);
    } else {
        console.error('エラー:', data.error);
    }
}

// ファイル検索
async function searchFiles(directory, pattern) {
    const response = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({directory, pattern, token: API_TOKEN})
    });
    const data = await response.json();
    
    if (data.success) {
        console.log('検索結果:', data.data);
    } else {
        console.error('エラー:', data.error);
    }
}

// ディレクトリ一覧
async function listDirectory(path) {
    const response = await fetch(`${API_BASE}/list?path=${encodeURIComponent(path)}&token=${encodeURIComponent(API_TOKEN)}`);
    const data = await response.json();
    
    if (data.success) {
        console.log('ファイル一覧:', data.data);
    } else {
        console.error('エラー:', data.error);
    }
}
```

## テスト

`example.html` をブラウザで開くことで、全てのAPI機能をテストできます。

## セキュリティ

- SHA256トークン認証
- CORS設定
- ローカルホストのみアクセス可能

## 技術仕様

- **言語**: Rust
- **Webフレームワーク**: Warp
- **非同期ランタイム**: Tokio
- **システムトレイ**: systray
- **GUI**: native-windows-gui (Windows)

## システム要件

- Windows 10/11 (64bit)
- 空き容量: 10MB以上
- メモリ: 50MB以上

## ライセンス

MIT License

## 更新履歴

### v1.0.0
- 初回リリース
- 基本的なファイル操作API実装
- システムトレイ対応
- 設定ダイアログ実装