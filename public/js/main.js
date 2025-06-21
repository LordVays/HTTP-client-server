document.addEventListener('DOMContentLoaded', () => {

    const searchForm = document.getElementById('search-form');
    const keywordInput = document.getElementById('keyword-input');
    const searchButton = document.getElementById('search-button');
    const clearButton = document.getElementById('clear-button');
    const urlList = document.getElementById('url-list');
    const savedList = document.getElementById('saved-list');
    const contentFrame = document.getElementById('content-frame');
    const messageArea = document.getElementById('message-area');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const progressSize = document.getElementById('progress-size');
    const viewerSourceUrl = document.getElementById('viewer-source-url');
    const viewerOpenOriginal = document.getElementById('viewer-open-original');
    const iframePlaceholder = contentFrame.srcdoc;
    const STORAGE_INDEX_KEY = 'downloaded_pages_index';

    let activeEventSource = null;

    // Поиск по ключевому слову
    searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const keyword = keywordInput.value.trim();
        if (keyword) {
            await fetchAndDisplayUrls(keyword);
        }
    });

    // Очистка результатов поиска
    clearButton.addEventListener('click', () => {
        keywordInput.value = '';
        urlList.innerHTML = '<li class="placeholder">Введите ключевое слово для поиска.</li>';
        clearMessages();
        progressContainer.style.display = 'none';
        keywordInput.focus();
    });

    // Клик на URL для скачивания
    urlList.addEventListener('click', (e) => {

        const li = e.target.closest('li[data-url]');

        if (!li) return;
        if (li.classList.contains('downloading')) return;
        if (li.classList.contains('downloaded')) {
            showMessage('Этот контент уже сохранен.', 'info');
            return;
        }

        const url = li.dataset.url;
        downloadUrl(url, li);

    });

    // Клик на сохраненный элемент для просмотра или удаления
    savedList.addEventListener('click', (e) => {

        const li = e.target.closest('li[data-url]');

        if (!li) return;
        if (e.target.closest('.delete-btn')) {
            deleteSavedContent(li.dataset.url);
        } else {
            displaySavedContent(li.dataset.url);
            savedList.querySelectorAll('li').forEach(item => item.classList.remove('active'));
            li.classList.add('active');
        }

    });
    

    // Запрос URL с сервера
    async function fetchAndDisplayUrls(keyword) {

        setLoadingState(true);
        clearMessages();
        urlList.innerHTML = '';
        progressContainer.style.display = 'none';

        try {
            const response = await fetch(`/api/urls?keyword=${encodeURIComponent(keyword)}`);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Ошибка сервера: ${response.status}`);
            }

            const urls = await response.json();

            displayUrls(urls);
        } catch (error) {
            showMessage(error.message, 'error');
            urlList.innerHTML = `<li class="placeholder">Ничего не найдено.</li>`;
        } finally {
            setLoadingState(false);
        }

    }

    // Отображение списка URL
    function displayUrls(urls) {

        if (urls.length === 0) {
            urlList.innerHTML = `<li class="placeholder">URL не найдены.</li>`;
            return;
        }

        const savedUrls = getSavedIndex(); 

        urls.forEach(url => {
            const li = document.createElement('li');
            li.dataset.url = url;
            
            if (savedUrls.includes(url)) {
                li.classList.add('downloaded');
                li.title = 'Контент уже сохранен';
            } else {
                li.title = 'Нажмите, чтобы скачать';
                li.setAttribute('role', 'button');
                li.tabIndex = 0;
            }

            li.textContent = url;

            urlList.appendChild(li);
        });

    }

    // Скачивание URL через SSE
    function downloadUrl(url, listItem) {
        if (activeEventSource) {
            activeEventSource.close();
        }
        
        listItem.classList.add('downloading');
        progressContainer.style.display = 'block';
        updateProgress(0, 0); 
        
        activeEventSource = new EventSource(`/api/download?url=${encodeURIComponent(url)}`);
        let totalSize = 0;

        activeEventSource.onmessage = (event) => {

            const data = JSON.parse(event.data);

            switch (data.type) {
                case 'size':
                    totalSize = data.payload;
                    break;
                case 'progress':
                    updateProgress(data.payload.progress, totalSize);
                    break;
                case 'done':
                    saveContent(url, data.payload);
                    updateProgress(totalSize, totalSize);
                    showMessage(`Контент для ${url} успешно сохранен!`, 'success');
                    listItem.classList.remove('downloading');
                    listItem.classList.add('downloaded');
                    listItem.title = 'Контент уже сохранен';
                    closeEventSource();
                    break;
                case 'error':
                    showMessage(data.payload, 'error');
                    progressContainer.style.display = 'none';
                    listItem.classList.remove('downloading');
                    closeEventSource();
                    break;
            }

        };

        activeEventSource.onerror = () => {
            if (activeEventSource.readyState === EventSource.CLOSED) {
               return; 
            }
            showMessage('Произошла ошибка соединения с сервером при загрузке.', 'error');
            progressContainer.style.display = 'none';
            listItem.classList.remove('downloading');
            closeEventSource();
        };
    }
    
    function closeEventSource() {
        if (activeEventSource) {
            activeEventSource.close();
            activeEventSource = null;
        }
    }


    function getSavedIndex() {
        return JSON.parse(localStorage.getItem(STORAGE_INDEX_KEY)) || [];
    }

    function saveContent(url, content) {

        try {
            const baseTag = `<base href="${new URL(url).origin}">`;
            let finalContent = content;

            if (/<head>/i.test(content)) {
                finalContent = content.replace(/<head>/i, `<head>${baseTag}`);
            } else { 
                finalContent = baseTag + content;
            }

            localStorage.setItem(url, finalContent);

            const index = getSavedIndex();

            if (!index.includes(url)) {
                index.push(url);
                localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(index));
            }

            loadAndDisplaySavedList();
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                showMessage('Не удалось сохранить контент. Хранилище переполнено.', 'error');
            } else {
                showMessage(`Произошла ошибка при сохранении: ${e.message}`, 'error');
            }

            console.error('Ошибка сохранения:', e);
        }

    }

    function deleteSavedContent(url) {

        localStorage.removeItem(url);
        let index = getSavedIndex().filter(item => item !== url);
        localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(index));
        loadAndDisplaySavedList();

        if (contentFrame.dataset.currentUrl === url) {
            resetViewer();
        }


        const searchResultItem = urlList.querySelector(`li[data-url="${url}"]`);
        if (searchResultItem) {
            searchResultItem.classList.remove('downloaded');
            searchResultItem.title = 'Нажмите, чтобы скачать';
        }

        showMessage(`Запись для ${url} удалена.`, 'info');

    }

    function loadAndDisplaySavedList() {

        const index = getSavedIndex();
        savedList.innerHTML = '';

        if (index.length === 0) {
            savedList.innerHTML = '<li class="placeholder">Пока ничего не сохранено.</li>';
            return;
        }

        index.forEach(url => {
            const li = document.createElement('li');
            li.dataset.url = url;
            li.setAttribute('role', 'button');
            li.tabIndex = 0;
            
            const urlSpan = document.createElement('span');
            urlSpan.textContent = url;
            li.appendChild(urlSpan);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.title = 'Удалить';
            deleteBtn.innerHTML = '×'; 
            li.appendChild(deleteBtn);

            savedList.appendChild(li);
        });

    }

    function displaySavedContent(url) {

        const content = localStorage.getItem(url);

        if (content) {
            contentFrame.srcdoc = content;
            contentFrame.dataset.currentUrl = url;
            viewerSourceUrl.textContent = url;
            viewerOpenOriginal.href = url;
            viewerOpenOriginal.style.display = 'inline-flex';
        } else {
            showMessage('Контент для этого URL не найден в хранилище.', 'error');
            resetViewer();
        }

    }

     function resetViewer() {
        contentFrame.srcdoc = iframePlaceholder;
        delete contentFrame.dataset.currentUrl;
        viewerSourceUrl.textContent = '';
        viewerOpenOriginal.href = '#';
        viewerOpenOriginal.style.display = 'none';
    }
    
    
    function updateProgress(current, total) {

        if (total > 0) {
            const percentage = Math.min(100, Math.round((current / total) * 100));
            progressBar.style.width = `${percentage}%`;
            progressText.textContent = `${percentage}%`;
            progressSize.textContent = `${(current / 1024).toFixed(1)} KB / ${(total / 1024).toFixed(1)} KB`;
        } else {
            progressBar.style.width = '100%';
            progressBar.style.backgroundColor = '#6c757d'; 
            progressText.textContent = 'Загрузка...';
            progressSize.textContent = `${(current / 1024).toFixed(1)} KB`;
        }

        if (current === 0) {
           progressBar.style.backgroundColor = 'var(--primary-color)';
        }

    }
    
    function showMessage(message, type = 'info') {

        messageArea.innerHTML = ''; 
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.textContent = message;
        messageArea.appendChild(messageDiv);
        messageArea.style.display = 'block';

        if(type === 'success' || type === 'info'){
            setTimeout(() => {
                messageDiv.style.opacity = '0';
                messageDiv.addEventListener('transitionend', () => messageDiv.remove());
            }, 4000);
        }
        
    }

    function clearMessages() {
        messageArea.style.display = 'none';
        messageArea.innerHTML = '';
    }

    function setLoadingState(isLoading) {
        searchButton.disabled = isLoading;
        keywordInput.disabled = isLoading;
        searchButton.textContent = isLoading ? 'Поиск...' : 'Найти';
    }


    loadAndDisplaySavedList();
    urlList.innerHTML = '<li class="placeholder">Введите ключевое слово для поиска.</li>';

});