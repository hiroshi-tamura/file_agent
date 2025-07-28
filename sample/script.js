class HighSpeedFileManager {
    constructor() {
        this.baseUrl = 'http://localhost:8767/api';
        this.token = 'default-token-12345';
        this.isOnline = false;
        
        // 高速化のためのキャッシュとバッファ
        this.cache = new Map();
        this.prefetchQueue = [];
        this.virtualScrollThreshold = 1000;
        
        // ナビゲーション履歴
        this.history = [];
        this.historyIndex = -1;
        
        // 現在の状態
        this.currentPath = null;
        this.currentView = 'list';
        this.selectedItems = new Set();
        this.expandedFolders = new Set();
        
        // ドライブ情報
        this.drives = [];
        this.activeDrive = null;
        
        // 検索・フィルタ
        this.searchQuery = '';
        this.isSearchMode = false;
        this.searchCache = new Map();
        
        // 仮想スクロール
        this.virtualScroll = {
            itemHeight: 36,
            visibleItems: 50,
            bufferItems: 10,
            scrollTop: 0
        };
        
        // クリップボード
        this.clipboard = {
            items: [],
            operation: null // 'copy' or 'cut'
        };
        
        // オーディオプレイヤー
        this.audioPlayer = {
            audio: null,
            isPlaying: false,
            currentFile: null,
            waveformData: null,
            canvas: null,
            ctx: null,
            analyser: null,
            dataArray: null,
            animationId: null
        };
        
        this.init();
    }

    async init() {
        await this.checkConnection();
        this.setupEventListeners();
        await this.loadDrives();
        this.setupVirtualScroll();
        this.setupAudioPlayer();
        
        // 定期的に接続状態をチェック（頻度を下げて高速化）
        setInterval(() => this.checkConnection(), 10000);
        
        // プリフェッチのためのアイドル時処理
        this.setupIdleCallback();
    }

    setupIdleCallback() {
        if ('requestIdleCallback' in window) {
            const prefetchWork = (deadline) => {
                while (deadline.timeRemaining() > 0 && this.prefetchQueue.length > 0) {
                    const path = this.prefetchQueue.shift();
                    this.prefetchDirectory(path);
                }
                requestIdleCallback(prefetchWork);
            };
            requestIdleCallback(prefetchWork);
        }
    }

    async checkConnection() {
        try {
            const response = await fetch(`${this.baseUrl}/health`, { 
                signal: AbortSignal.timeout(3000) 
            });
            if (response.ok) {
                this.setConnectionStatus(true);
                return true;
            }
        } catch (error) {
            // 接続エラーは無視（高速化のため）
        }
        this.setConnectionStatus(false);
        return false;
    }

    setConnectionStatus(online) {
        if (this.isOnline === online) return;
        
        this.isOnline = online;
        const statusElement = document.getElementById('connectionStatus');
        statusElement.className = `status-indicator ${online ? 'online' : 'offline'}`;
        
        if (online) {
            this.showStatus('接続済み', 'success');
        } else {
            this.showStatus('オフライン', 'error');
        }
    }

    setupEventListeners() {
        // ナビゲーションボタン
        document.getElementById('backBtn').addEventListener('click', () => this.goBack());
        document.getElementById('forwardBtn').addEventListener('click', () => this.goForward());
        document.getElementById('upBtn').addEventListener('click', () => this.goUp());
        document.getElementById('homeBtn').addEventListener('click', () => this.goHome());
        
        // アドレスバー
        const addressInput = document.getElementById('addressInput');
        addressInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.navigateToPath(addressInput.value);
        });
        document.getElementById('goBtn').addEventListener('click', () => {
            this.navigateToPath(addressInput.value);
        });
        
        // 検索（高速化）
        const searchInput = document.getElementById('searchInput');
        searchInput.addEventListener('input', debounce((e) => {
            this.performFastSearch(e.target.value);
        }, 200));
        document.getElementById('searchBtn').addEventListener('click', () => {
            this.performFastSearch(searchInput.value);
        });
        
        // ビュー切り替え
        document.getElementById('listView').addEventListener('click', () => this.setView('list'));
        document.getElementById('gridView').addEventListener('click', () => this.setView('grid'));
        document.getElementById('detailView').addEventListener('click', () => this.setView('detail'));
        
        // ツリー更新
        document.getElementById('refreshTreeBtn').addEventListener('click', () => this.refreshTree());
        
        // グローバルキーボードショートカット
        document.addEventListener('keydown', (e) => this.handleGlobalKeyboard(e));
        
        // コンテキストメニュー
        document.addEventListener('contextmenu', (e) => this.handleContextMenu(e));
        document.addEventListener('click', () => this.hideContextMenu());
        
        // ファイルリストのスクロール（仮想スクロール用）
        const fileList = document.getElementById('fileList');
        fileList.addEventListener('scroll', throttle((e) => {
            this.handleVirtualScroll(e);
        }, 16)); // 60fps
        
        // リサイズハンドラー
        window.addEventListener('resize', debounce(() => this.handleResize(), 250));
    }

    async loadDrives() {
        this.showStatus('ドライブを検索中...', 'loading');
        
        try {
            // Windowsの標準ドライブをチェック
            const driveLetters = ['C', 'D', 'E', 'F', 'G', 'H'];
            const drives = [];
            
            // 並列でドライブをチェック（高速化）
            const drivePromises = driveLetters.map(async (letter) => {
                try {
                    const path = `${letter}:\\`;
                    const data = await this.apiCall('list', { path });
                    if (data.success) {
                        return {
                            letter,
                            path,
                            label: `${letter}: ドライブ`,
                            type: this.getDriveType(letter),
                            available: true
                        };
                    }
                } catch (error) {
                    // ドライブが存在しない場合は無視
                }
                return null;
            });
            
            const results = await Promise.all(drivePromises);
            this.drives = results.filter(drive => drive !== null);
            
            this.renderDrives();
            
            if (this.drives.length > 0) {
                await this.selectDrive(this.drives[0]);
            }
            
            this.showStatus(`${this.drives.length}個のドライブを検出`, 'success');
        } catch (error) {
            console.error('Failed to load drives:', error);
            this.showStatus('ドライブの読み込みに失敗', 'error');
        }
    }

    getDriveType(letter) {
        const types = {
            'C': { icon: '💾', type: 'HDD' },
            'D': { icon: '💿', type: 'CD/DVD' },
            'E': { icon: '🔌', type: 'USB' },
            'F': { icon: '🔌', type: 'USB' },
            'G': { icon: '🔌', type: 'USB' },
            'H': { icon: '🔌', type: 'USB' }
        };
        return types[letter] || { icon: '💾', type: 'ドライブ' };
    }

    renderDrives() {
        const container = document.getElementById('drivesContainer');
        
        if (this.drives.length === 0) {
            container.innerHTML = '<div class="loading-drives">ドライブが見つかりません</div>';
            return;
        }
        
        const drivesHTML = this.drives.map(drive => {
            const driveType = this.getDriveType(drive.letter);
            const isActive = this.activeDrive && this.activeDrive.letter === drive.letter;
            
            return `
                <div class="drive-item ${isActive ? 'active' : ''}" data-drive="${drive.letter}">
                    <span class="drive-icon">${driveType.icon}</span>
                    <div class="drive-info">
                        <span>${drive.letter}:</span>
                        <span class="drive-usage">${driveType.type}</span>
                    </div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = drivesHTML;
        
        // イベントリスナーを追加
        container.querySelectorAll('.drive-item').forEach(item => {
            item.addEventListener('click', async () => {
                const driveLetter = item.dataset.drive;
                const drive = this.drives.find(d => d.letter === driveLetter);
                if (drive) await this.selectDrive(drive);
            });
        });
    }

    async selectDrive(drive) {
        this.activeDrive = drive;
        this.renderDrives(); // アクティブ状態を更新
        
        await this.navigateToPath(drive.path);
    }

    async navigateToPath(path, addToHistory = true) {
        if (!path || !this.isOnline) return;
        
        // パスを正規化
        path = path.replace(/\//g, '\\').replace(/\\+$/, '');
        if (path.length === 2 && path.endsWith(':')) path += '\\';
        
        this.showStatus(`${path} を読み込み中...`, 'loading');
        
        try {
            const startTime = performance.now();
            
            // キャッシュをチェック（高速化）
            let data;
            if (this.cache.has(path)) {
                data = this.cache.get(path);
                console.log(`Cache hit for ${path}`);
            } else {
                data = await this.apiCall('list', { path });
                if (data.success) {
                    this.cache.set(path, data);
                    // キャッシュサイズ制限（メモリ使用量を制御）
                    if (this.cache.size > 100) {
                        const firstKey = this.cache.keys().next().value;
                        this.cache.delete(firstKey);
                    }
                }
            }
            
            if (data.success) {
                this.currentPath = path;
                
                // 履歴に追加
                if (addToHistory) {
                    this.addToHistory(path);
                }
                
                // UI更新
                this.updateAddressBar(path);
                this.updateBreadcrumb(path);
                this.renderFileList(data.data);
                this.updateNavigationButtons();
                
                // サイドバーのツリーを更新
                await this.updateFolderTree(path);
                
                // プリフェッチ（アイドル時に実行）
                this.queuePrefetch(data.data);
                
                const loadTime = performance.now() - startTime;
                this.showStatus(`${data.data.length}個のアイテム (${loadTime.toFixed(1)}ms)`, 'success');
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            console.error('Navigation failed:', error);
            this.showStatus(`エラー: ${error.message}`, 'error');
        }
    }

    queuePrefetch(items) {
        // サブフォルダをプリフェッチキューに追加
        const folders = items.filter(item => !item.is_file).slice(0, 5); // 最初の5個のフォルダのみ
        folders.forEach(folder => {
            if (!this.cache.has(folder.path)) {
                this.prefetchQueue.push(folder.path);
            }
        });
    }

    async prefetchDirectory(path) {
        try {
            const data = await this.apiCall('list', { path });
            if (data.success) {
                this.cache.set(path, data);
            }
        } catch (error) {
            // プリフェッチエラーは無視
        }
    }

    addToHistory(path) {
        // 重複を避ける
        if (this.history[this.historyIndex] === path) return;
        
        // 現在位置より後の履歴を削除
        this.history.splice(this.historyIndex + 1);
        this.history.push(path);
        this.historyIndex = this.history.length - 1;
        
        // 履歴サイズ制限
        if (this.history.length > 50) {
            this.history.shift();
            this.historyIndex--;
        }
    }

    goBack() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.navigateToPath(this.history[this.historyIndex], false);
        }
    }

    goForward() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.navigateToPath(this.history[this.historyIndex], false);
        }
    }

    goUp() {
        if (!this.currentPath) return;
        
        const parentPath = this.getParentPath(this.currentPath);
        if (parentPath && parentPath !== this.currentPath) {
            this.navigateToPath(parentPath);
        }
    }

    goHome() {
        if (this.activeDrive) {
            this.navigateToPath(this.activeDrive.path);
        }
    }

    getParentPath(path) {
        if (!path || path.length <= 3) return null; // C:\ の場合
        
        const lastSlash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
        if (lastSlash <= 2) return path.substring(0, 3); // C:\ を返す
        
        return path.substring(0, lastSlash);
    }

    updateAddressBar(path) {
        document.getElementById('addressInput').value = path;
    }

    updateBreadcrumb(path) {
        const breadcrumb = document.getElementById('breadcrumb');
        const parts = path.split('\\').filter(part => part);
        
        let currentPath = '';
        const breadcrumbHTML = parts.map((part, index) => {
            currentPath += (index === 0) ? part + '\\' : part + '\\';
            const isLast = index === parts.length - 1;
            
            return `
                <span class="breadcrumb-item ${isLast ? 'active' : ''}" data-path="${currentPath}">
                    ${index === 0 ? '💾' : '📁'} ${part}
                </span>
                ${!isLast ? '<span class="breadcrumb-separator">></span>' : ''}
            `;
        }).join('');
        
        breadcrumb.innerHTML = breadcrumbHTML;
        
        // クリックイベントを追加
        breadcrumb.querySelectorAll('.breadcrumb-item:not(.active)').forEach(item => {
            item.addEventListener('click', () => {
                this.navigateToPath(item.dataset.path);
            });
        });
    }

    updateNavigationButtons() {
        document.getElementById('backBtn').disabled = this.historyIndex <= 0;
        document.getElementById('forwardBtn').disabled = this.historyIndex >= this.history.length - 1;
        document.getElementById('upBtn').disabled = !this.getParentPath(this.currentPath);
    }

    setupVirtualScroll() {
        const fileList = document.getElementById('fileList');
        this.virtualScroll.container = fileList;
    }

    handleVirtualScroll(e) {
        if (this.currentView !== 'list' || !this.currentItems) return;
        
        const container = e.target;
        const scrollTop = container.scrollTop;
        const containerHeight = container.clientHeight;
        
        const startIndex = Math.floor(scrollTop / this.virtualScroll.itemHeight);
        const endIndex = Math.min(
            startIndex + this.virtualScroll.visibleItems + this.virtualScroll.bufferItems,
            this.currentItems.length
        );
        
        this.renderVirtualItems(startIndex, endIndex);
    }

    renderVirtualItems(startIndex, endIndex) {
        const container = document.getElementById('fileList');
        const items = this.currentItems.slice(startIndex, endIndex);
        
        const topPadding = startIndex * this.virtualScroll.itemHeight;
        const bottomPadding = (this.currentItems.length - endIndex) * this.virtualScroll.itemHeight;
        
        const itemsHTML = items.map((item, index) => 
            this.createFileItemHTML(item, startIndex + index)
        ).join('');
        
        container.innerHTML = `
            <div style="height: ${topPadding}px;"></div>
            ${itemsHTML}
            <div style="height: ${bottomPadding}px;"></div>
        `;
        
        this.attachFileEventListeners();
    }

    renderFileList(items) {
        this.currentItems = items;
        document.getElementById('fileCount').textContent = items.length;
        
        const fileList = document.getElementById('fileList');
        fileList.className = `file-list ${this.currentView}-view`;
        
        if (items.length === 0) {
            fileList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📂</div>
                    <p>このフォルダは空です</p>
                </div>
            `;
            return;
        }
        
        // 仮想スクロールを使用するかどうか
        if (this.currentView === 'list' && items.length > this.virtualScrollThreshold) {
            this.renderVirtualItems(0, this.virtualScroll.visibleItems);
        } else {
            this.renderAllItems(items);
        }
    }

    renderAllItems(items) {
        const fileList = document.getElementById('fileList');
        
        // ファイルとフォルダを分けてソート（高速化）
        const folders = [];
        const files = [];
        
        for (const item of items) {
            if (item.is_file) {
                files.push(item);
            } else {
                folders.push(item);
            }
        }
        
        folders.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => a.name.localeCompare(b.name));
        
        const sortedItems = [...folders, ...files];
        
        if (this.currentView === 'detail') {
            this.renderDetailView(sortedItems, fileList);
        } else {
            const itemsHTML = sortedItems.map((item, index) => 
                this.createFileItemHTML(item, index)
            ).join('');
            fileList.innerHTML = itemsHTML;
        }
        
        this.attachFileEventListeners();
    }

    renderDetailView(items, container) {
        const headerHTML = `
            <div class="file-header">
                <div class="file-header-cell">名前</div>
                <div class="file-header-cell">更新日時</div>
                <div class="file-header-cell">種類</div>
                <div class="file-header-cell">サイズ</div>
            </div>
        `;
        
        const itemsHTML = items.map((item, index) => {
            const icon = this.getFileIcon(item);
            const type = item.is_file ? this.getFileType(item.name) : 'フォルダ';
            const size = item.is_file && item.size ? this.formatFileSize(item.size) : '';
            
            return `
                <div class="file-item" data-index="${index}" data-path="${item.path}" data-is-file="${item.is_file}">
                    <div class="file-cell name">
                        <span class="file-icon">${icon}</span>
                        <span class="file-name">${item.name}</span>
                    </div>
                    <div class="file-cell">-</div>
                    <div class="file-cell">${type}</div>
                    <div class="file-cell">${size}</div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = headerHTML + itemsHTML;
    }

    createFileItemHTML(item, index) {
        const icon = this.getFileIcon(item);
        const size = item.is_file && item.size ? this.formatFileSize(item.size) : '';
        const type = item.is_file ? this.getFileType(item.name) : 'フォルダ';
        
        if (this.currentView === 'grid') {
            return `
                <div class="file-item" data-index="${index}" data-path="${item.path}" data-is-file="${item.is_file}">
                    <span class="file-icon">${icon}</span>
                    <div class="file-info">
                        <div class="file-name" title="${item.name}">${item.name}</div>
                        <div class="file-details">
                            <span>${type}</span>
                            ${size ? `<span>${size}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        } else {
            return `
                <div class="file-item" data-index="${index}" data-path="${item.path}" data-is-file="${item.is_file}">
                    <span class="file-icon">${icon}</span>
                    <div class="file-info">
                        <div class="file-name" title="${item.name}">${item.name}</div>
                        <div class="file-details">
                            <span>${type}</span>
                            ${size ? `<span>${size}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }
    }

    getFileIcon(item) {
        if (!item.is_file) return '📁';
        
        const ext = item.name.split('.').pop()?.toLowerCase();
        const iconMap = {
            // 画像
            'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'bmp': '🖼️', 'svg': '🖼️', 'webp': '🖼️',
            // 動画
            'mp4': '🎬', 'avi': '🎬', 'mov': '🎬', 'wmv': '🎬', 'flv': '🎬', 'mkv': '🎬',
            // 音声
            'mp3': '🎵', 'wav': '🎵', 'flac': '🎵', 'aac': '🎵', 'ogg': '🎵',
            // ドキュメント
            'txt': '📄', 'md': '📝', 'doc': '📄', 'docx': '📄', 'pdf': '📕', 'rtf': '📄',
            'xls': '📊', 'xlsx': '📊', 'ppt': '📊', 'pptx': '📊',
            // プログラミング
            'js': '📜', 'ts': '📜', 'html': '🌐', 'css': '🎨', 'json': '📋', 'xml': '📋',
            'py': '🐍', 'java': '☕', 'cpp': '🔧', 'c': '🔧', 'h': '🔧',
            'php': '🌐', 'rb': '💎', 'go': '🐹', 'rs': '🔧', 'kt': '🎯',
            // アーカイブ
            'zip': '📦', 'rar': '📦', '7z': '📦', 'tar': '📦', 'gz': '📦',
            // 実行ファイル
            'exe': '⚙️', 'msi': '⚙️', 'bat': '⚙️', 'cmd': '⚙️', 'ps1': '⚙️'
        };
        
        return iconMap[ext] || '📄';
    }

    getFileType(filename) {
        const ext = filename.split('.').pop()?.toLowerCase();
        const typeMap = {
            'jpg': 'JPEG画像', 'jpeg': 'JPEG画像', 'png': 'PNG画像', 'gif': 'GIF画像',
            'mp4': 'MP4動画', 'avi': 'AVI動画', 'mov': 'MOV動画',
            'mp3': 'MP3音声', 'wav': 'WAV音声',
            'txt': 'テキスト', 'doc': 'Word文書', 'pdf': 'PDF文書',
            'zip': 'ZIPアーカイブ', 'exe': '実行ファイル',
            'js': 'JavaScript', 'html': 'HTML文書', 'css': 'スタイルシート'
        };
        
        return typeMap[ext] || `${ext?.toUpperCase() || ''}ファイル`;
    }

    formatFileSize(bytes) {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
    }

    attachFileEventListeners() {
        document.querySelectorAll('.file-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.ctrlKey) {
                    this.toggleSelection(item);
                } else {
                    this.selectSingle(item);
                }
            });
            
            item.addEventListener('dblclick', async (e) => {
                const path = item.dataset.path;
                const isFile = item.dataset.isFile === 'true';
                
                if (isFile) {
                    // オーディオファイルかチェック
                    if (this.isAudioFile(path)) {
                        await this.loadAudioFile(path);
                    }
                } else {
                    await this.navigateToPath(path);
                }
            });
        });
    }

    selectSingle(item) {
        document.querySelectorAll('.file-item.selected').forEach(el => {
            el.classList.remove('selected');
        });
        item.classList.add('selected');
        this.selectedItems.clear();
        this.selectedItems.add(item.dataset.path);
    }

    toggleSelection(item) {
        const path = item.dataset.path;
        if (this.selectedItems.has(path)) {
            this.selectedItems.delete(path);
            item.classList.remove('selected');
        } else {
            this.selectedItems.add(path);
            item.classList.add('selected');
        }
    }

    setView(view) {
        this.currentView = view;
        
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById(`${view}View`).classList.add('active');
        
        if (this.currentItems) {
            this.renderFileList(this.currentItems);
        }
    }

    async updateFolderTree(currentPath) {
        // 簡略化されたツリー更新（高速化のため詳細実装は省略）
        const treeContainer = document.getElementById('folderTree');
        treeContainer.innerHTML = `<div class="tree-item selected">${currentPath}</div>`;
    }

    async refreshTree() {
        this.cache.clear();
        if (this.currentPath) {
            await this.navigateToPath(this.currentPath, false);
        }
    }

    async performFastSearch(query) {
        if (!query.trim()) {
            this.isSearchMode = false;
            this.searchCache.clear();
            if (this.currentPath) {
                await this.navigateToPath(this.currentPath, false);
            }
            return;
        }
        
        this.isSearchMode = true;
        this.searchQuery = query;
        
        // キャッシュをチェック（高速化）
        const cacheKey = `${this.currentPath || 'root'}:${query.toLowerCase()}`;
        if (this.searchCache.has(cacheKey)) {
            const cachedResults = this.searchCache.get(cacheKey);
            this.renderFileList(cachedResults);
            this.showStatus(`${cachedResults.length}件見つかりました (キャッシュ)`, 'success');
            return;
        }
        
        this.showStatus(`"${query}" を検索中...`, 'loading');
        
        try {
            const startTime = performance.now();
            
            // 複数のパターンで並列検索（高速化）
            const searchPromises = [
                this.apiCall('search', {
                    directory: this.currentPath || 'C:\\',
                    pattern: `*${query}*`
                })
            ];
            
            // 拡張子での検索も追加
            if (query.length > 2) {
                searchPromises.push(
                    this.apiCall('search', {
                        directory: this.currentPath || 'C:\\',
                        pattern: `*.${query}*`
                    })
                );
            }
            
            const results = await Promise.allSettled(searchPromises);
            const allItems = new Map(); // 重複排除用
            
            results.forEach(result => {
                if (result.status === 'fulfilled' && result.value.success) {
                    result.value.data.forEach(item => {
                        allItems.set(item.path, item);
                    });
                }
            });
            
            const finalResults = Array.from(allItems.values());
            
            // 関連度でソート（高速化）
            finalResults.sort((a, b) => {
                const aRelevance = this.calculateRelevance(a.name, query);
                const bRelevance = this.calculateRelevance(b.name, query);
                return bRelevance - aRelevance;
            });
            
            // キャッシュに保存
            this.searchCache.set(cacheKey, finalResults);
            
            // キャッシュサイズ制限
            if (this.searchCache.size > 50) {
                const firstKey = this.searchCache.keys().next().value;
                this.searchCache.delete(firstKey);
            }
            
            this.renderFileList(finalResults);
            const searchTime = performance.now() - startTime;
            this.showStatus(`${finalResults.length}件見つかりました (${searchTime.toFixed(1)}ms)`, 'success');
            
        } catch (error) {
            console.error('Search failed:', error);
            this.showStatus(`検索エラー: ${error.message}`, 'error');
        }
    }
    
    calculateRelevance(filename, query) {
        const name = filename.toLowerCase();
        const q = query.toLowerCase();
        
        // 完全一致は最高スコア
        if (name === q) return 1000;
        
        // 先頭一致は高スコア
        if (name.startsWith(q)) return 800;
        
        // 単語境界での一致は中スコア
        if (name.includes(`_${q}`) || name.includes(`-${q}`) || name.includes(` ${q}`)) return 600;
        
        // 部分一致は基本スコア
        if (name.includes(q)) return 400;
        
        // マッチしない場合は0
        return 0;
    }

    handleGlobalKeyboard(e) {
        // Ctrl+L: アドレスバーにフォーカス
        if (e.ctrlKey && e.key === 'l') {
            e.preventDefault();
            document.getElementById('addressInput').focus();
        }
        
        // Ctrl+F: 検索にフォーカス
        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            document.getElementById('searchInput').focus();
        }
        
        // Alt+Left: 戻る
        if (e.altKey && e.key === 'ArrowLeft') {
            e.preventDefault();
            this.goBack();
        }
        
        // Alt+Right: 進む
        if (e.altKey && e.key === 'ArrowRight') {
            e.preventDefault();
            this.goForward();
        }
        
        // Alt+Up: 上へ
        if (e.altKey && e.key === 'ArrowUp') {
            e.preventDefault();
            this.goUp();
        }
        
        // F5: 更新
        if (e.key === 'F5') {
            e.preventDefault();
            this.refreshTree();
        }
        
        // Delete: 削除
        if (e.key === 'Delete' && this.selectedItems.size > 0) {
            e.preventDefault();
            this.deleteSelectedItems();
        }
        
        // Ctrl+C: コピー
        if (e.ctrlKey && e.key === 'c' && this.selectedItems.size > 0) {
            e.preventDefault();
            this.copySelectedItems();
        }
        
        // Ctrl+X: 切り取り
        if (e.ctrlKey && e.key === 'x' && this.selectedItems.size > 0) {
            e.preventDefault();
            this.cutSelectedItems();
        }
        
        // Ctrl+V: 貼り付け
        if (e.ctrlKey && e.key === 'v' && this.clipboard.items.length > 0) {
            e.preventDefault();
            this.pasteItems();
        }
        
        // スペースキー: 再生・一時停止（オーディオプレイヤーが表示されている場合）
        if (e.key === ' ' && !e.ctrlKey && this.audioPlayer.currentFile) {
            // フォーカスが入力フィールドにない場合のみ
            if (!['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                this.togglePlayPause();
            }
        }
        
        // Ctrl+スペースキー: 停止（オーディオプレイヤーが表示されている場合）
        if (e.ctrlKey && e.key === ' ' && this.audioPlayer.currentFile) {
            e.preventDefault();
            this.stopAudio();
        }
    }

    handleContextMenu(e) {
        const fileItem = e.target.closest('.file-item');
        const isOnFile = !!fileItem;
        
        e.preventDefault();
        
        if (isOnFile) {
            this.selectSingle(fileItem);
            this.showContextMenu(e.clientX, e.clientY, 'contextMenu');
        } else {
            this.showContextMenu(e.clientX, e.clientY, 'newItemMenu');
        }
    }

    showContextMenu(x, y, menuId) {
        const menu = document.getElementById(menuId);
        menu.style.display = 'block';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        
        // 画面端での調整
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = `${x - rect.width}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${y - rect.height}px`;
        }
        
        // メニューアイテムのイベントリスナー
        menu.querySelectorAll('.menu-item').forEach(item => {
            item.onclick = () => {
                this.handleContextMenuAction(item.dataset.action);
                this.hideContextMenu();
            };
        });
    }

    hideContextMenu() {
        document.querySelectorAll('.context-menu').forEach(menu => {
            menu.style.display = 'none';
        });
    }

    async handleContextMenuAction(action) {
        const selectedPath = Array.from(this.selectedItems)[0];
        
        switch (action) {
            case 'open':
                if (selectedPath) {
                    const item = this.currentItems.find(i => i.path === selectedPath);
                    if (item && !item.is_file) {
                        await this.navigateToPath(selectedPath);
                    }
                }
                break;
                
            case 'copy':
                this.copySelectedItems();
                break;
                
            case 'cut':
                this.cutSelectedItems();
                break;
                
            case 'paste':
                await this.pasteItems();
                break;
                
            case 'delete':
                await this.deleteSelectedItems();
                break;
                
            case 'rename':
                this.renameItem(selectedPath);
                break;
                
            case 'copy-path':
                await this.copyToClipboard(selectedPath);
                this.showStatus('パスをコピーしました', 'success');
                break;
                
            case 'properties':
                this.showProperties(selectedPath);
                break;
                
            case 'new-folder':
                await this.createNewFolder();
                break;
                
            case 'new-file':
                await this.createNewFile();
                break;
        }
    }

    copySelectedItems() {
        this.clipboard.items = Array.from(this.selectedItems);
        this.clipboard.operation = 'copy';
        this.showStatus(`${this.clipboard.items.length}個のアイテムをコピーしました`, 'success');
    }

    cutSelectedItems() {
        this.clipboard.items = Array.from(this.selectedItems);
        this.clipboard.operation = 'cut';
        this.showStatus(`${this.clipboard.items.length}個のアイテムを切り取りました`, 'success');
    }

    async pasteItems() {
        if (this.clipboard.items.length === 0 || !this.currentPath) return;
        
        this.showStatus('貼り付け中...', 'loading');
        
        try {
            for (const sourcePath of this.clipboard.items) {
                const fileName = sourcePath.split('\\').pop();
                const destinationPath = `${this.currentPath}\\${fileName}`;
                
                if (this.clipboard.operation === 'copy') {
                    await this.apiCall('copy', {
                        source: sourcePath,
                        destination: destinationPath
                    });
                } else if (this.clipboard.operation === 'cut') {
                    await this.apiCall('move', {
                        source: sourcePath,
                        destination: destinationPath
                    });
                }
            }
            
            if (this.clipboard.operation === 'cut') {
                this.clipboard.items = [];
            }
            
            await this.navigateToPath(this.currentPath, false);
            this.showStatus('貼り付けが完了しました', 'success');
        } catch (error) {
            console.error('Paste failed:', error);
            this.showStatus(`貼り付けエラー: ${error.message}`, 'error');
        }
    }

    async deleteSelectedItems() {
        if (this.selectedItems.size === 0) return;
        
        const count = this.selectedItems.size;
        if (!confirm(`${count}個のアイテムを削除しますか？`)) return;
        
        this.showStatus('削除中...', 'loading');
        
        try {
            for (const path of this.selectedItems) {
                await this.apiCall('delete', { path });
            }
            
            this.selectedItems.clear();
            await this.navigateToPath(this.currentPath, false);
            this.showStatus(`${count}個のアイテムを削除しました`, 'success');
        } catch (error) {
            console.error('Delete failed:', error);
            this.showStatus(`削除エラー: ${error.message}`, 'error');
        }
    }

    async createNewFolder() {
        const name = prompt('新しいフォルダ名を入力してください:', '新しいフォルダ');
        if (!name || !this.currentPath) return;
        
        const path = `${this.currentPath}\\${name}`;
        
        try {
            await this.apiCall('create', {
                path,
                is_directory: true
            });
            
            await this.navigateToPath(this.currentPath, false);
            this.showStatus('フォルダを作成しました', 'success');
        } catch (error) {
            console.error('Create folder failed:', error);
            this.showStatus(`フォルダ作成エラー: ${error.message}`, 'error');
        }
    }

    async createNewFile() {
        const name = prompt('新しいファイル名を入力してください:', '新しいファイル.txt');
        if (!name || !this.currentPath) return;
        
        const path = `${this.currentPath}\\${name}`;
        
        try {
            await this.apiCall('create', {
                path,
                is_directory: false
            });
            
            await this.navigateToPath(this.currentPath, false);
            this.showStatus('ファイルを作成しました', 'success');
        } catch (error) {
            console.error('Create file failed:', error);
            this.showStatus(`ファイル作成エラー: ${error.message}`, 'error');
        }
    }

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            // フォールバック
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
        }
    }

    showProperties(path) {
        const item = this.currentItems?.find(i => i.path === path);
        if (!item) return;
        
        const size = item.is_file ? this.formatFileSize(item.size) : '-';
        const type = item.is_file ? this.getFileType(item.name) : 'フォルダ';
        
        alert(`名前: ${item.name}\nパス: ${path}\n種類: ${type}\nサイズ: ${size}`);
    }

    handleResize() {
        if (this.currentView === 'list' && this.currentItems?.length > this.virtualScrollThreshold) {
            this.virtualScroll.visibleItems = Math.ceil(
                document.getElementById('fileList').clientHeight / this.virtualScroll.itemHeight
            );
        }
    }

    showStatus(message, type = 'info') {
        const statusElement = document.getElementById('statusText');
        statusElement.textContent = message;
        
        const colors = {
            'success': '#27ae60',
            'error': '#e74c3c',
            'loading': '#f39c12',
            'info': '#ffffff'
        };
        
        statusElement.style.color = colors[type] || colors.info;
        
        if (type === 'error') {
            setTimeout(() => {
                statusElement.textContent = '準備完了';
                statusElement.style.color = colors.info;
            }, 5000);
        }
    }

    // オーディオプレイヤー関連の機能
    setupAudioPlayer() {
        this.audioPlayer.canvas = document.getElementById('waveformCanvas');
        this.audioPlayer.ctx = this.audioPlayer.canvas.getContext('2d');
        
        // オーディオプレイヤーのイベントリスナー
        document.getElementById('playPauseBtn').addEventListener('click', () => this.togglePlayPause());
        document.getElementById('stopBtn').addEventListener('click', () => this.stopAudio());
        document.getElementById('closeAudioPlayer').addEventListener('click', () => this.closeAudioPlayer());
        
        // 音量コントロール
        const volumeSlider = document.getElementById('volumeSlider');
        volumeSlider.addEventListener('input', (e) => {
            const volume = e.target.value / 100;
            if (this.audioPlayer.audio) {
                this.audioPlayer.audio.volume = volume;
            }
            document.getElementById('volumeValue').textContent = `${e.target.value}%`;
        });
        
        // 波形キャンバスでのシーク
        this.audioPlayer.canvas.addEventListener('click', (e) => this.seekToPosition(e));
        this.audioPlayer.canvas.addEventListener('mousemove', (e) => this.showSeekLine(e));
        this.audioPlayer.canvas.addEventListener('mouseleave', () => this.hideSeekLine());
        
        // キャンバスサイズ調整
        this.resizeWaveformCanvas();
        window.addEventListener('resize', () => this.resizeWaveformCanvas());
    }
    
    isAudioFile(path) {
        const audioExtensions = ['mp3', 'wav', 'aif', 'aiff', 'ogg', 'flac', 'm4a', 'aac'];
        const ext = path.split('.').pop()?.toLowerCase();
        return audioExtensions.includes(ext);
    }
    
    async loadAudioFile(path) {
        try {
            this.showStatus('オーディオファイルを読み込み中...', 'loading');
            
            // File Agent経由でバイナリファイルを読み込み
            const fileData = await this.apiCall('read_binary', { path });
            
            if (!fileData.success) {
                throw new Error(fileData.error);
            }
            
            // Base64データをBlob URLに変換
            const byteCharacters = atob(fileData.data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            
            // MIMEタイプを拡張子から判定
            const ext = path.split('.').pop()?.toLowerCase();
            const mimeType = this.getMimeTypeFromExtension(ext);
            const blob = new Blob([byteArray], { type: mimeType });
            const audioUrl = URL.createObjectURL(blob);
            
            // 既存のオーディオを停止
            if (this.audioPlayer.audio) {
                this.audioPlayer.audio.pause();
                URL.revokeObjectURL(this.audioPlayer.audio.src);
            }
            
            // 新しいオーディオを作成
            this.audioPlayer.audio = new Audio(audioUrl);
            this.audioPlayer.currentFile = path;
            this.audioPlayer.isPlaying = false;
            
            // オーディオイベント設定
            this.setupAudioEvents();
            
            // UIを更新
            this.showAudioPlayer();
            this.updateAudioInfo(path);
            
            // 実際の波形を生成
            await this.generateRealWaveform(byteArray);
            
            this.showStatus('オーディオファイルを読み込みました', 'success');
            
        } catch (error) {
            console.error('Audio load failed:', error);
            this.showStatus(`オーディオ読み込みエラー: ${error.message}`, 'error');
        }
    }
    
    getMimeTypeFromExtension(ext) {
        const mimeTypes = {
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'aif': 'audio/aiff',
            'aiff': 'audio/aiff',
            'ogg': 'audio/ogg',
            'flac': 'audio/flac',
            'm4a': 'audio/mp4',
            'aac': 'audio/aac'
        };
        return mimeTypes[ext] || 'audio/mpeg';
    }
    
    setupAudioEvents() {
        if (!this.audioPlayer.audio) return;
        
        const audio = this.audioPlayer.audio;
        
        audio.addEventListener('loadedmetadata', () => {
            document.getElementById('totalTime').textContent = this.formatTime(audio.duration);
            this.setupAudioAnalyser();
        });
        
        audio.addEventListener('timeupdate', () => {
            document.getElementById('currentTime').textContent = this.formatTime(audio.currentTime);
            this.updateProgressLine();
        });
        
        audio.addEventListener('ended', () => {
            this.audioPlayer.isPlaying = false;
            document.getElementById('playPauseBtn').textContent = '▶️';
            this.stopPeakMeterAnimation();
        });
        
        audio.addEventListener('error', (e) => {
            console.error('Audio playback error:', e);
            this.showStatus('オーディオ再生エラー', 'error');
        });
    }
    
    setupAudioAnalyser() {
        if (!this.audioPlayer.audio) return;
        
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaElementSource(this.audioPlayer.audio);
            const analyser = audioContext.createAnalyser();
            
            analyser.fftSize = 2048;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            source.connect(analyser);
            analyser.connect(audioContext.destination);
            
            this.audioPlayer.analyser = analyser;
            this.audioPlayer.dataArray = dataArray;
            
        } catch (error) {
            console.warn('Web Audio API not supported:', error);
        }
    }
    
    async generateWaveform() {
        if (!this.audioPlayer.audio) return;
        
        const canvas = this.audioPlayer.canvas;
        const ctx = this.audioPlayer.ctx;
        const width = canvas.width;
        const height = canvas.height;
        
        // キャンバスをクリア
        ctx.fillStyle = '#0f0f0f';
        ctx.fillRect(0, 0, width, height);
        
        // 仮の波形を描画（実際のオーディオ解析は複雑なので簡略化）
        ctx.strokeStyle = '#4ecdc4';
        ctx.lineWidth = 1;
        ctx.beginPath();
        
        const centerY = height / 2;
        const segments = 1000;
        
        for (let i = 0; i < segments; i++) {
            const x = (i / segments) * width;
            const amplitude = Math.random() * 0.8 + 0.1; // ランダムな振幅
            const y1 = centerY - (amplitude * centerY * 0.8);
            const y2 = centerY + (amplitude * centerY * 0.8);
            
            if (i === 0) {
                ctx.moveTo(x, y1);
            } else {
                ctx.lineTo(x, y1);
            }
        }
        
        ctx.stroke();
        
        // 下半分の波形
        ctx.beginPath();
        for (let i = 0; i < segments; i++) {
            const x = (i / segments) * width;
            const amplitude = Math.random() * 0.8 + 0.1;
            const y = centerY + (amplitude * centerY * 0.8);
            
            if (i === 0) {
                ctx.moveTo(x, centerY);
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
    }
    
    async generateRealWaveform(audioData) {
        try {
            const canvas = this.audioPlayer.canvas;
            const ctx = this.audioPlayer.ctx;
            const width = canvas.width;
            const height = canvas.height;
            
            // キャンバスをクリア
            ctx.fillStyle = '#0f0f0f';
            ctx.fillRect(0, 0, width, height);
            
            // Web Audio APIでオーディオデータを解析
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const arrayBuffer = audioData.buffer;
            
            try {
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                const rawData = audioBuffer.getChannelData(0); // 左チャンネル
                const samples = width; // 表示する波形の点数
                const blockSize = Math.floor(rawData.length / samples);
                const filteredData = [];
                
                // ダウンサンプリング
                for (let i = 0; i < samples; i++) {
                    let blockStart = blockSize * i;
                    let sum = 0;
                    for (let j = 0; j < blockSize; j++) {
                        sum = sum + Math.abs(rawData[blockStart + j]);
                    }
                    filteredData.push(sum / blockSize);
                }
                
                // 正規化
                const maxValue = Math.max(...filteredData);
                const normalizedData = filteredData.map(val => val / maxValue);
                
                // 波形を描画
                ctx.strokeStyle = '#4ecdc4';
                ctx.lineWidth = 2;
                ctx.beginPath();
                
                const centerY = height / 2;
                
                for (let i = 0; i < normalizedData.length; i++) {
                    const x = (i / normalizedData.length) * width;
                    const amplitude = normalizedData[i];
                    const y1 = centerY - (amplitude * centerY * 0.8);
                    const y2 = centerY + (amplitude * centerY * 0.8);
                    
                    ctx.moveTo(x, y1);
                    ctx.lineTo(x, y2);
                }
                
                ctx.stroke();
                
                // ステレオの場合は右チャンネルも描画
                if (audioBuffer.numberOfChannels > 1) {
                    const rightData = audioBuffer.getChannelData(1);
                    const rightFiltered = [];
                    
                    for (let i = 0; i < samples; i++) {
                        let blockStart = blockSize * i;
                        let sum = 0;
                        for (let j = 0; j < blockSize; j++) {
                            sum = sum + Math.abs(rightData[blockStart + j]);
                        }
                        rightFiltered.push(sum / blockSize);
                    }
                    
                    const maxRightValue = Math.max(...rightFiltered);
                    const normalizedRightData = rightFiltered.map(val => val / maxRightValue);
                    
                    ctx.strokeStyle = '#ff6b6b';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    
                    for (let i = 0; i < normalizedRightData.length; i++) {
                        const x = (i / normalizedRightData.length) * width;
                        const amplitude = normalizedRightData[i];
                        const y1 = centerY - (amplitude * centerY * 0.4);
                        const y2 = centerY + (amplitude * centerY * 0.4);
                        
                        ctx.moveTo(x, y1);
                        ctx.lineTo(x, y2);
                    }
                    
                    ctx.stroke();
                }
                
            } catch (decodeError) {
                console.warn('Audio decode failed, using fallback waveform:', decodeError);
                await this.generateWaveform(); // フォールバック
            }
            
        } catch (error) {
            console.warn('Waveform generation error:', error);
            await this.generateWaveform(); // フォールバック
        }
    }
    
    showAudioPlayer() {
        document.getElementById('audioPlayer').classList.remove('hidden');
    }
    
    closeAudioPlayer() {
        if (this.audioPlayer.audio) {
            this.audioPlayer.audio.pause();
            URL.revokeObjectURL(this.audioPlayer.audio.src);
            this.audioPlayer.audio = null;
        }
        
        this.stopPeakMeterAnimation();
        document.getElementById('audioPlayer').classList.add('hidden');
        this.audioPlayer.currentFile = null;
        this.audioPlayer.isPlaying = false;
    }
    
    updateAudioInfo(path) {
        const filename = path.split('\\').pop();
        document.getElementById('audioFilename').textContent = filename;
        
        // ファイル形式情報を取得（簡略化）
        const ext = filename.split('.').pop()?.toUpperCase();
        const formatInfo = this.getAudioFormatInfo(ext);
        document.getElementById('audioFormat').textContent = formatInfo;
    }
    
    getAudioFormatInfo(ext) {
        const formats = {
            'MP3': 'MP3 • 44.1kHz • 16bit • ステレオ',
            'WAV': 'WAV • 44.1kHz • 16bit • ステレオ',
            'AIF': 'AIFF • 44.1kHz • 16bit • ステレオ',
            'AIFF': 'AIFF • 44.1kHz • 16bit • ステレオ',
            'FLAC': 'FLAC • 44.1kHz • 24bit • ステレオ',
            'OGG': 'OGG • 44.1kHz • 16bit • ステレオ',
            'M4A': 'AAC • 44.1kHz • 16bit • ステレオ',
            'AAC': 'AAC • 44.1kHz • 16bit • ステレオ'
        };
        
        return formats[ext] || `${ext} • オーディオファイル`;
    }
    
    togglePlayPause() {
        if (!this.audioPlayer.audio) return;
        
        if (this.audioPlayer.isPlaying) {
            this.audioPlayer.audio.pause();
            this.audioPlayer.isPlaying = false;
            document.getElementById('playPauseBtn').textContent = '▶️';
            this.stopPeakMeterAnimation();
        } else {
            this.audioPlayer.audio.play();
            this.audioPlayer.isPlaying = true;
            document.getElementById('playPauseBtn').textContent = '⏸️';
            this.startPeakMeterAnimation();
        }
    }
    
    stopAudio() {
        if (!this.audioPlayer.audio) return;
        
        this.audioPlayer.audio.pause();
        this.audioPlayer.audio.currentTime = 0;
        this.audioPlayer.isPlaying = false;
        document.getElementById('playPauseBtn').textContent = '▶️';
        this.updateProgressLine();
        this.stopPeakMeterAnimation();
    }
    
    seekToPosition(e) {
        if (!this.audioPlayer.audio) return;
        
        const canvas = this.audioPlayer.canvas;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = x / canvas.width;
        const newTime = percentage * this.audioPlayer.audio.duration;
        
        this.audioPlayer.audio.currentTime = newTime;
    }
    
    showSeekLine(e) {
        const canvas = this.audioPlayer.canvas;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        
        const seekLine = document.getElementById('seekLine');
        seekLine.style.left = `${x}px`;
        seekLine.style.display = 'block';
    }
    
    hideSeekLine() {
        document.getElementById('seekLine').style.display = 'none';
    }
    
    updateProgressLine() {
        if (!this.audioPlayer.audio) return;
        
        const percentage = this.audioPlayer.audio.currentTime / this.audioPlayer.audio.duration;
        const canvas = this.audioPlayer.canvas;
        const x = percentage * canvas.width;
        
        document.getElementById('progressLine').style.left = `${x}px`;
    }
    
    startPeakMeterAnimation() {
        if (!this.audioPlayer.analyser) return;
        
        const animatePeakMeter = () => {
            if (!this.audioPlayer.isPlaying) return;
            
            this.audioPlayer.analyser.getByteFrequencyData(this.audioPlayer.dataArray);
            
            // 左右チャンネルのピークを計算（簡略化）
            const leftPeak = this.audioPlayer.dataArray.slice(0, 50).reduce((max, val) => Math.max(max, val), 0) / 255;
            const rightPeak = this.audioPlayer.dataArray.slice(50, 100).reduce((max, val) => Math.max(max, val), 0) / 255;
            
            // ピークメーターを更新
            const leftBar = document.getElementById('peakMeterL');
            const rightBar = document.getElementById('peakMeterR');
            
            leftBar.style.setProperty('--peak-height', `${(1 - leftPeak) * 100}%`);
            rightBar.style.setProperty('--peak-height', `${(1 - rightPeak) * 100}%`);
            
            this.audioPlayer.animationId = requestAnimationFrame(animatePeakMeter);
        };
        
        animatePeakMeter();
    }
    
    stopPeakMeterAnimation() {
        if (this.audioPlayer.animationId) {
            cancelAnimationFrame(this.audioPlayer.animationId);
            this.audioPlayer.animationId = null;
        }
        
        // ピークメーターをリセット
        const leftBar = document.getElementById('peakMeterL');
        const rightBar = document.getElementById('peakMeterR');
        leftBar.style.setProperty('--peak', 0);
        rightBar.style.setProperty('--peak', 0);
    }
    
    resizeWaveformCanvas() {
        const canvas = this.audioPlayer.canvas;
        const container = canvas.parentElement;
        
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        
        // 波形を再描画
        if (this.audioPlayer.currentFile) {
            this.generateWaveform();
        }
    }
    
    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    async apiCall(endpoint, params = {}) {
        const isGet = endpoint === 'list' || endpoint === 'health';
        
        let url = `${this.baseUrl}/${endpoint}`;
        let options = {
            method: isGet ? 'GET' : 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            // タイムアウトを設定（バイナリファイルは時間がかかる可能性がある）
            signal: AbortSignal.timeout(endpoint === 'read_binary' ? 30000 : (endpoint === 'health' ? 3000 : 10000))
        };

        if (isGet && endpoint === 'list') {
            const searchParams = new URLSearchParams({
                path: params.path,
                token: this.token
            });
            url += `?${searchParams}`;
        } else if (!isGet) {
            options.body = JSON.stringify({
                ...params,
                token: this.token
            });
        }

        const response = await fetch(url, options);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    }
}

// 高速化のためのユーティリティ関数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// アプリケーション初期化
document.addEventListener('DOMContentLoaded', () => {
    window.fileManager = new HighSpeedFileManager();
});

// パフォーマンス監視
if ('performance' in window) {
    window.addEventListener('load', () => {
        const loadTime = performance.now();
        console.log(`File Manager loaded in ${loadTime.toFixed(2)}ms`);
    });
}

// メモリリーク対策
window.addEventListener('beforeunload', () => {
    if (window.fileManager) {
        window.fileManager.cache.clear();
        window.fileManager.prefetchQueue.length = 0;
    }
});