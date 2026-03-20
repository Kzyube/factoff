const supabaseUrl = 'https://emnydyqwsmdxggepotlv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtbnlkeXF3c21keGdnZXBvdGx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5Nzg5MzIsImV4cCI6MjA4OTU1NDkzMn0.rtG9j5qUm5Tr0YolFDA6VubafWNK4M0TdvFBWqDcWEs';
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = null;
let currentUserRole = 'participant';
let currentTopicFilter = 'All';
let currentActiveClaimId = null;
let currentValidateClaimId = null;

// Global Memory for Real-Time Search & Render
let allFetchedClaims = [];
let globalDbVotes = [];

// Bookmarks logic
function getBookmarks() { 
    if (!currentUser) return [];
    return JSON.parse(localStorage.getItem(`factoff_bookmarks_${currentUser.id}`) || '[]'); 
}
function saveBookmarks(bms) { 
    if (!currentUser) return;
    localStorage.setItem(`factoff_bookmarks_${currentUser.id}`, JSON.stringify(bms)); 
}

// --- INITIALIZATION ---
window.onload = async () => {
    if (localStorage.getItem('theme') === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
        document.getElementById('theme-icon').className = 'fa-solid fa-sun';
    }

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return window.location.href = 'auth.html';
    currentUser = session.user;
    
    const { data: userData } = await supabaseClient.from('users').select('role, profile_pic_url').eq('id', currentUser.id).single();
    if (userData) {
        currentUserRole = userData.role;
        
        if (currentUserRole === 'validator') {
            document.getElementById('validator-badges-link').style.display = 'flex';
            document.getElementById('bookmarks-link').style.display = 'none';
        }

        if (userData.profile_pic_url) {
            const imgHTML = `<img src="${userData.profile_pic_url}" alt="Profile">`;
            document.getElementById('user-avatar-container').innerHTML = imgHTML;
            document.getElementById('mini-avatar').innerHTML = imgHTML;
            document.getElementById('comment-my-avatar').innerHTML = imgHTML;
        }
    }
    
    document.getElementById('search-input').addEventListener('input', handleRealTimeSearch);

    fetchClaims();
};

function toggleTheme() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    document.body.setAttribute('data-theme', isDark ? 'light' : 'dark');
    document.getElementById('theme-icon').className = isDark ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
}

async function logout() {
    await supabaseClient.auth.signOut();
    window.location.href = 'auth.html';
}

// --- GLOBAL CLICK LISTENER (Closes Dropdowns) ---
window.onclick = function(event) {
    if (!event.target.closest('.post-options-wrap')) {
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            menu.classList.remove('show');
        });
    }
}

window.toggleDropdown = (id) => {
    document.querySelectorAll('.dropdown-menu').forEach(menu => {
        if(menu.id !== `dropdown-${id}`) menu.classList.remove('show');
    });
    document.getElementById(`dropdown-${id}`).classList.toggle('show');
}

window.sharePost = (id) => {
    const dummyUrl = window.location.origin + '/?post=' + id;
    navigator.clipboard.writeText(dummyUrl).then(() => {
        alert("Post link copied to clipboard!");
    }).catch(err => {
        alert("Failed to copy. Here is the link: " + dummyUrl);
    });
    document.getElementById(`dropdown-${id}`).classList.remove('show');
}

// --- CREATE POST MODAL LOGIC ---
const modal = document.getElementById('post-modal');
const fileInput = document.getElementById('claim-files');
const fileList = document.getElementById('file-preview-list');

function openPostModal() { modal.classList.add('active'); }
function closePostModal() { modal.classList.remove('active'); document.getElementById('claim-form').reset(); fileList.innerHTML = ''; }

fileInput.addEventListener('change', () => {
    fileList.innerHTML = Array.from(fileInput.files).map(file => `<div style="margin-bottom: 5px;"><i class="fa-solid fa-file-lines" style="color:var(--primary); margin-right:5px;"></i> ${file.name}</div>`).join('');
});

window.addCustomTag = () => {
    const input = document.getElementById('custom-tag-input');
    const val = input.value.trim();
    if(val) {
        document.getElementById('modal-tags').insertAdjacentHTML('beforeend', `<label class="tag-label"><input type="checkbox" value="${val}" name="tags" checked> ${val}</label>`);
        input.value = '';
    }
};

document.getElementById('claim-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-claim-btn');
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Deploying...';
    btn.disabled = true;

    const content = document.getElementById('claim-text').value;
    const linkInput = document.getElementById('claim-link').value;
    const files = Array.from(fileInput.files);
    const tags = Array.from(document.querySelectorAll('input[name="tags"]:checked')).map(cb => cb.value);

    try {
        let evidenceUrls = [];
        if(linkInput) evidenceUrls.push(linkInput);

        for (const file of files) {
            const filePath = `${currentUser.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
            await supabaseClient.storage.from('evidence').upload(filePath, file);
            evidenceUrls.push(supabaseClient.storage.from('evidence').getPublicUrl(filePath).data.publicUrl);
        }

        await supabaseClient.from('claims').insert([{
            author_id: currentUser.id,
            content: content,
            evidence_urls: evidenceUrls,
            tags: tags,
            upvotes: 0,
            downvotes: 0
        }]);

        closePostModal();
        currentTopicFilter = 'All';
        
        document.getElementById('search-input').value = '';
        
        document.querySelectorAll('#sidebar-topics li').forEach(li => li.classList.remove('active-tag'));
        document.querySelectorAll('#sidebar-topics li')[0].classList.add('active-tag');
        document.querySelectorAll('#sidebar-main-links li').forEach(li => li.classList.remove('active-link'));
        document.querySelectorAll('#sidebar-main-links li')[0].classList.add('active-link');

        fetchClaims(); 
    } catch (error) {
        alert("Upload Error: " + error.message);
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Deploy Claim';
        btn.disabled = false;
    }
});


// --- FILTERING LOGIC ---
window.filterByTag = (tag) => {
    currentTopicFilter = tag;
    document.querySelectorAll('#sidebar-topics li').forEach(li => li.classList.remove('active-tag'));
    document.querySelectorAll('#sidebar-topics li').forEach(item => {
        if(item.innerText.includes(tag) || (tag === 'All' && item.innerText.includes('All'))) item.classList.add('active-tag');
    });

    document.querySelectorAll('#sidebar-main-links li').forEach(li => li.classList.remove('active-link'));
    
    if (tag === 'Queue') document.querySelectorAll('#sidebar-main-links li')[2].classList.add('active-link');
    else if (tag === 'Trending') document.querySelectorAll('#sidebar-main-links li')[1].classList.add('active-link');
    else if (tag === 'Bookmarks' && currentUserRole !== 'validator') document.querySelectorAll('#sidebar-main-links li')[3].classList.add('active-link');
    else if (tag === 'All') document.querySelectorAll('#sidebar-main-links li')[0].classList.add('active-link');

    document.getElementById('search-input').value = '';
    fetchClaims();
};

function handleRealTimeSearch(e) {
    const searchTerm = e.target.value.toLowerCase().trim();
    if (!searchTerm) {
        renderClaims(allFetchedClaims);
        return;
    }
    const filteredClaims = allFetchedClaims.filter(claim => {
        const matchContent = claim.content.toLowerCase().includes(searchTerm);
        const matchAuthor = (claim.author?.display_name || '').toLowerCase().includes(searchTerm);
        const matchTags = claim.tags ? claim.tags.some(t => t.toLowerCase().includes(searchTerm)) : false;
        return matchContent || matchAuthor || matchTags;
    });
    renderClaims(filteredClaims);
}


// --- EARN BADGES SYSTEM ---
window.openBadgesModal = async () => {
    document.getElementById('badges-modal').classList.add('active');
    document.getElementById('badges-container-list').innerHTML = `<div class="spinner" style="margin: 0 auto;"></div>`;

    const { count } = await supabaseClient.from('claims')
        .select('*', { count: 'exact', head: true })
        .eq('validator_id', currentUser.id)
        .eq('status', 'RESOLVED');
        
    const valCount = count || 0;
    document.getElementById('total-validations-count').innerText = valCount;

    const { data: uData } = await supabaseClient.from('users').select('earned_badges').eq('id', currentUser.id).single();
    const earned = uData?.earned_badges || [];

    // FIX: Using Custom Images instead of FontAwesome Icons!
    const badges = [
        { id: 'blue', name: 'AI Detector', color: 'blue', img: 'Assets/aiDetector.png', required: 3 },
        { id: 'orange', name: 'Truth Veteran', color: 'orange', img: 'Assets/truthVeteran.png', required: 5 },
        { id: 'red', name: 'Misinformation Slayer', color: 'red', img: 'Assets/misinformationSlayer.png', required: 7 }
    ];

    let html = '';
    badges.forEach(b => {
        let btnHtml = '';
        if (earned.includes(b.id)) {
            btnHtml = `<button class="btn-primary-small" style="background: var(--success); cursor: default;"><i class="fa-solid fa-check"></i> Claimed</button>`;
        } else if (valCount >= b.required) {
            btnHtml = `<button class="btn-primary-small" onclick="claimBadge('${b.id}')">Claim Badge</button>`;
        } else {
            btnHtml = `<button class="btn-primary-small" style="background: var(--bg-base); color: var(--text-muted); cursor: default;"><i class="fa-solid fa-lock"></i> ${valCount}/${b.required}</button>`;
        }

        html += `
            <div class="badge-card">
                <div class="badge-info">
                    <div class="badge-icon ${b.color}">
                        <img src="${b.img}" alt="${b.name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
                    </div>
                    <div class="badge-details">
                        <h4>${b.name}</h4>
                        <p>Requires ${b.required} Validated Claims</p>
                    </div>
                </div>
                ${btnHtml}
            </div>
        `;
    });
    
    document.getElementById('badges-container-list').innerHTML = html;
};

window.closeBadgesModal = () => {
    document.getElementById('badges-modal').classList.remove('active');
};

window.claimBadge = async (badgeId) => {
    const { data: uData } = await supabaseClient.from('users').select('earned_badges').eq('id', currentUser.id).single();
    let earned = uData?.earned_badges || [];
    
    if (!earned.includes(badgeId)) {
        earned.push(badgeId);
        await supabaseClient.from('users').update({ earned_badges: earned }).eq('id', currentUser.id);
        
        let cached = JSON.parse(localStorage.getItem('factoff_cached_profile') || '{}');
        cached.earned_badges = earned;
        localStorage.setItem('factoff_cached_profile', JSON.stringify(cached));
        
        alert('Badge Successfully Claimed! It will now display on your profile.');
        openBadgesModal(); 
    }
};

// --- VOTING SYSTEM ---
window.castVote = async (claimId, voteType) => {
    const upBtn = document.getElementById(`upvote-btn-${claimId}`);
    const downBtn = document.getElementById(`downvote-btn-${claimId}`);
    const upCountEl = document.getElementById(`upvote-count-${claimId}`);
    const downCountEl = document.getElementById(`downvote-count-${claimId}`);

    const isCurrentlyUp = upBtn.classList.contains('upvote-active');
    const isCurrentlyDown = downBtn.classList.contains('downvote-active');
    
    let currentVote = isCurrentlyUp ? 'up' : (isCurrentlyDown ? 'down' : null);

    if (currentVote === voteType) {
        if (voteType === 'up') { upCountEl.innerText = parseInt(upCountEl.innerText) - 1; upBtn.classList.remove('upvote-active'); }
        else { downCountEl.innerText = parseInt(downCountEl.innerText) - 1; downBtn.classList.remove('downvote-active'); }
        await supabaseClient.from('claim_votes').delete().match({ claim_id: claimId, user_id: currentUser.id });
    } else {
        if (currentVote === 'up') { upCountEl.innerText = parseInt(upCountEl.innerText) - 1; upBtn.classList.remove('upvote-active'); }
        if (currentVote === 'down') { downCountEl.innerText = parseInt(downCountEl.innerText) - 1; downBtn.classList.remove('downvote-active'); }
        
        if (voteType === 'up') { upCountEl.innerText = parseInt(upCountEl.innerText) + 1; upBtn.classList.add('upvote-active'); }
        else { downCountEl.innerText = parseInt(downCountEl.innerText) + 1; downBtn.classList.add('downvote-active'); }
        
        await supabaseClient.from('claim_votes').upsert({ claim_id: claimId, user_id: currentUser.id, vote_type: voteType });
    }

    const { data: allVotes } = await supabaseClient.from('claim_votes').select('vote_type').eq('claim_id', claimId);
    let totalUp = 0; let totalDown = 0;
    if(allVotes) { allVotes.forEach(v => { if(v.vote_type==='up') totalUp++; else totalDown++; }); }
    await supabaseClient.from('claims').update({ upvotes: totalUp, downvotes: totalDown }).eq('id', claimId);
};

window.toggleBookmark = (id) => {
    let bms = getBookmarks();
    const btn = document.getElementById(`bookmark-btn-${id}`);
    if (bms.includes(id)) {
        bms = bms.filter(x => x !== id);
        btn.classList.remove('bookmarked-active');
        if(currentTopicFilter === 'Bookmarks') document.getElementById(`claim-${id}`).remove();
    } else {
        bms.push(id);
        btn.classList.add('bookmarked-active');
    }
    saveBookmarks(bms);
};

// --- FACEBOOK STYLE COMMENTS ---
const commentModal = document.getElementById('comment-modal');
const commentFilePreview = document.getElementById('comment-media-preview');
const commentFileInput = document.getElementById('comment-file-upload');

if (commentFileInput) {
    commentFileInput.addEventListener('change', () => {
        if(commentFileInput.files[0]) {
            commentFilePreview.style.display = 'block';
            commentFilePreview.innerText = `Attached: ${commentFileInput.files[0].name}`;
        }
    });
}

window.openCommentModal = async (claimId) => {
    currentActiveClaimId = claimId;
    commentModal.classList.add('active');
    
    const originalPostNode = document.getElementById(`claim-${claimId}`);
    document.getElementById('comment-original-post').innerHTML = originalPostNode.innerHTML;
    document.getElementById('comment-original-post').querySelector('.post-footer').style.display = 'none';

    loadComments();
};

window.closeCommentModal = () => {
    commentModal.classList.remove('active');
    document.getElementById('comment-input').value = '';
    if(commentFileInput) commentFileInput.value = '';
    if(commentFilePreview) commentFilePreview.style.display = 'none';
};

async function loadComments() {
    const list = document.getElementById('comments-list');
    list.innerHTML = `<div class="spinner" style="margin: 0 auto;"></div>`;

    const { data: comments } = await supabaseClient.from('comments')
        .select('*, users(display_name, profile_pic_url)')
        .eq('claim_id', currentActiveClaimId)
        .order('created_at', { ascending: true });

    list.innerHTML = '';
    if(!comments || comments.length === 0) {
        list.innerHTML = `<p style="text-align:center; color:var(--text-muted);">No comments yet. Be the first to verify or debunk!</p>`;
        return;
    }

    comments.forEach(c => {
        const name = c.users?.display_name || "User";
        const avatar = c.users?.profile_pic_url || 'https://via.placeholder.com/35';
        
        let media = '';
        if (c.media_url) {
            const lowUrl = c.media_url.toLowerCase();
            if (lowUrl.includes('.pdf')) {
                media = `<a href="${c.media_url}" target="_blank" class="evidence-link-box" style="margin-top: 10px;"><i class="fa-solid fa-file-pdf" style="color: var(--danger); font-size: 1.2rem;"></i> View Attached PDF</a>`;
            } else if (lowUrl.match(/\.(doc|docx|ppt|pptx|xls|xlsx)$/i)) {
                media = `<a href="${c.media_url}" target="_blank" class="evidence-link-box" style="margin-top: 10px;"><i class="fa-solid fa-file-word" style="color: var(--primary); font-size: 1.2rem;"></i> Download Document</a>`;
            } else {
                media = `<img src="${c.media_url}" class="comment-media-img">`;
            }
        }
        
        list.innerHTML += `
            <div class="comment-bubble">
                <img src="${avatar}">
                <div>
                    <div class="comment-content-box">
                        <strong>${name}</strong>
                        <p>${c.content}</p>
                        ${media}
                    </div>
                    <div class="comment-time">${new Date(c.created_at).toLocaleTimeString()}</div>
                </div>
            </div>
        `;
    });
}

window.submitComment = async () => {
    const input = document.getElementById('comment-input');
    const content = input.value.trim();
    const file = commentFileInput ? commentFileInput.files[0] : null;
    
    if(!content && !file) return;

    try {
        let mediaUrl = null;
        if(file) {
            const filePath = `${currentUser.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
            await supabaseClient.storage.from('comment_media').upload(filePath, file);
            mediaUrl = supabaseClient.storage.from('comment_media').getPublicUrl(filePath).data.publicUrl;
        }

        await supabaseClient.from('comments').insert([{
            claim_id: currentActiveClaimId, user_id: currentUser.id, content: content || "Attached a file.", media_url: mediaUrl
        }]);

        const countSpan = document.getElementById(`comment-count-${currentActiveClaimId}`);
        if (countSpan) {
            let currentCount = parseInt(countSpan.innerText.replace(/[^0-9]/g, '') || '0');
            countSpan.innerText = `(${currentCount + 1})`;
        }
        
        const claimInMem = allFetchedClaims.find(c => c.id === currentActiveClaimId);
        if(claimInMem) {
            if(!claimInMem.comments) claimInMem.comments = [];
            claimInMem.comments.push({id: 'temp'}); 
        }

        input.value = '';
        if (commentFileInput) commentFileInput.value = '';
        if (commentFilePreview) commentFilePreview.style.display = 'none';
        
        loadComments(); 

    } catch (e) {
        alert("Error posting comment: " + e.message);
    }
};

window.deleteClaim = async (id) => {
    if (!confirm("Remove this claim from the grid permanently?")) return;
    const claimElement = document.getElementById(`claim-${id}`);
    if (claimElement) claimElement.style.display = 'none';

    const { error } = await supabaseClient.from('claims').delete().eq('id', id);
    if (error) {
        if (claimElement) claimElement.style.display = 'block'; 
        alert("Database Error: You don't have permission to delete this.");
    } else {
        if (claimElement) claimElement.remove();
        allFetchedClaims = allFetchedClaims.filter(c => c.id !== id);
    }
};

// --- VALIDATOR LOGIC & PROOF MODAL ---
window.openValidateModal = (claimId) => {
    currentValidateClaimId = claimId;
    document.getElementById('validate-modal').classList.add('active');
};

window.closeValidateModal = () => {
    document.getElementById('validate-modal').classList.remove('active');
    document.getElementById('validate-form').reset();
    document.getElementById('validate-file-preview').innerHTML = '';
};

document.getElementById('validate-files').addEventListener('change', (e) => {
    document.getElementById('validate-file-preview').innerHTML = Array.from(e.target.files).map(file => `<div style="margin-bottom: 5px;"><i class="fa-solid fa-check" style="color:var(--success); margin-right:5px;"></i> ${file.name}</div>`).join('');
});

document.getElementById('validate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-validate-btn');
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...';
    btn.disabled = true;

    const verdict = document.querySelector('input[name="verdict"]:checked').value;
    const isTrending = document.getElementById('trending-checkbox').checked;
    const notes = document.getElementById('validate-notes').value;
    const files = Array.from(document.getElementById('validate-files').files);

    try {
        let evidenceUrls = [];
        for (const file of files) {
            const filePath = `validator_${currentUser.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
            await supabaseClient.storage.from('evidence').upload(filePath, file);
            evidenceUrls.push(supabaseClient.storage.from('evidence').getPublicUrl(filePath).data.publicUrl);
        }

        const { error } = await supabaseClient.from('claims').update({
            status: 'RESOLVED',
            verdict: verdict,
            is_trending: isTrending,
            validator_notes: notes,
            validator_evidence: evidenceUrls,
            validator_id: currentUser.id
        }).eq('id', currentValidateClaimId);

        if (error) throw new Error(error.message);

        closeValidateModal();
        fetchClaims(); 

    } catch (err) {
        alert("Validation Error: " + err.message);
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-gavel"></i> Submit Validation';
        btn.disabled = false;
    }
});

// View Proof Modal
window.openProofModal = (claimId) => {
    const claim = allFetchedClaims.find(c => c.id === claimId);
    if (!claim) return;

    let modalHtml = `
        <div style="margin-bottom: 1.5rem;">
            <p style="font-size: 0.8rem; font-weight: bold; color: var(--text-muted); text-transform: uppercase;">Final Verdict:</p>
            <strong style="color: ${claim.verdict === 'REAL' ? 'var(--success)' : 'var(--danger)'}; font-size: 1.2rem;">
                <i class="fa-solid ${claim.verdict === 'REAL' ? 'fa-check-circle' : 'fa-times-circle'}"></i> ${claim.verdict}
            </strong>
        </div>
        <div style="margin-bottom: 1.5rem; background: var(--bg-base); padding: 1rem; border-radius: 8px; border: 1px solid var(--border-color);">
            <p style="font-size: 0.8rem; font-weight: bold; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.5rem;">Validator Explanation:</p>
            <p style="color: var(--text-main); font-size: 0.95rem; line-height: 1.6;">${claim.validator_notes || 'No explanation provided.'}</p>
        </div>
        <div>
            <p style="font-size: 0.8rem; font-weight: bold; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.5rem;">Attached Evidence:</p>
    `;

    if (claim.validator_evidence && claim.validator_evidence.length > 0) {
        modalHtml += `<div class="post-media-grid" style="border:none; padding:0; background:transparent;">`;
        claim.validator_evidence.forEach(url => {
            const lowerUrl = url.toLowerCase();
            if (lowerUrl.includes('.pdf')) {
                modalHtml += `<iframe src="${url}" class="media-preview-pdf" title="PDF Document" frameborder="0"></iframe>`;
            } else if (lowerUrl.match(/\.(doc|docx|ppt|pptx|xls|xlsx)$/i)) {
                modalHtml += `<a href="${url}" target="_blank" class="evidence-link-box"><i class="fa-solid fa-file-word" style="color:var(--primary); font-size:1.2rem;"></i> Download Document</a>`;
            } else {
                modalHtml += `<img src="${url}" class="media-preview-img" alt="Validator Evidence" loading="lazy">`;
            }
        });
        modalHtml += `</div>`;
    } else {
        modalHtml += `<p style="color: var(--text-muted);">No files attached.</p>`;
    }

    document.getElementById('proof-modal-body').innerHTML = modalHtml;
    document.getElementById('proof-modal').classList.add('active');
};

window.closeProofModal = () => {
    document.getElementById('proof-modal').classList.remove('active');
};


// --- FETCH DATA FROM DATABASE ---
async function fetchClaims() {
    const feedContainer = document.getElementById('feed-container');

    try {
        const { data } = await supabaseClient.from('claim_votes').select('claim_id, user_id, vote_type').eq('user_id', currentUser.id);
        if (data) globalDbVotes = data;
    } catch(err) { console.warn("Vote table fetching issue", err); }
    
    let query = supabaseClient.from('claims').select('*, author:users!author_id (profile_pic_url, display_name), comments(id)').order('created_at', { ascending: false });
    
    if (currentTopicFilter === 'Bookmarks') {
        const myBookmarks = getBookmarks();
        if (myBookmarks.length === 0) {
            feedContainer.innerHTML = `<div class="loading-state"><i class="fa-solid fa-bookmark fa-3x" style="opacity:0.3; margin-bottom:1rem;"></i><p>You haven't bookmarked any claims yet.</p></div>`;
            return;
        }
        query = query.in('id', myBookmarks);
    } else if (currentTopicFilter === 'Queue') {
        query = query.eq('status', 'UNRESOLVED');
    } else if (currentTopicFilter === 'Trending') {
        query = query.eq('is_trending', true);
    } else if (currentTopicFilter !== 'All') {
        query = query.contains('tags', [currentTopicFilter]); 
    }

    const { data: claims, error } = await query;
    
    if (error) {
        feedContainer.innerHTML = `<div class="interactive-card post-card slide-up" style="text-align: center; padding: 3rem; color: var(--danger);"><i class="fa-solid fa-triangle-exclamation fa-2x" style="margin-bottom: 1rem;"></i><h3>Database Fetch Error:</h3><p>${error.message}</p></div>`;
        return;
    }

    allFetchedClaims = claims || [];
    renderClaims(allFetchedClaims);
}

// --- EXPLICIT PDF & DOCUMENT RENDERING ENGINE ---
function renderClaims(claimsToRender) {
    const feedContainer = document.getElementById('feed-container');
    feedContainer.innerHTML = ''; 

    if (!claimsToRender || claimsToRender.length === 0) {
        feedContainer.innerHTML = `
            <div class="interactive-card post-card slide-up" style="text-align: center; padding: 3rem;">
                <i class="fa-solid fa-ghost fa-3x" style="color: var(--border-color); margin-bottom: 1rem;"></i>
                <h3 style="color: var(--text-muted);">No claims found.</h3>
            </div>
        `;
        return;
    }

    const localBookmarks = getBookmarks();

    claimsToRender.forEach((claim, index) => {
        const trendingClass = claim.is_trending ? 'trending-post-card' : '';

        let tagsHtml = claim.tags ? claim.tags.map(tag => `<span class="post-tag">${tag}</span>`).join('') : '';
        
        let verdictClass = 'verdict-unresolved'; 
        let verdictIcon = 'fa-circle-question';
        let statusText = claim.status || 'UNRESOLVED';

        if (claim.status === 'RESOLVED') {
            if (claim.verdict === 'REAL') { verdictClass = 'verdict-real'; verdictIcon = 'fa-check-circle'; statusText = 'RESOLVED: REAL'; }
            if (claim.verdict === 'FAKE') { verdictClass = 'verdict-fake'; verdictIcon = 'fa-times-circle'; statusText = 'RESOLVED: FAKE'; }
        }

        let trendingBadge = claim.is_trending ? `<span class="trending-badge"><i class="fa-solid fa-fire"></i> TRENDING</span>` : '';

        let mediaHtml = '';
        if (claim.evidence_urls && claim.evidence_urls.length > 0) {
            mediaHtml += `<div class="post-media-grid">`;
            claim.evidence_urls.forEach(url => {
                const lowerUrl = url.toLowerCase();
                
                if (lowerUrl.includes('.pdf')) {
                    mediaHtml += `<iframe src="${url}" class="media-preview-pdf" title="PDF Document" frameborder="0"></iframe>`;
                } else if (lowerUrl.match(/\.(doc|docx|ppt|pptx|xls|xlsx)$/i)) {
                    mediaHtml += `<a href="${url}" target="_blank" class="evidence-link-box"><i class="fa-solid fa-file-word" style="color:var(--primary); font-size:1.2rem;"></i> Download Document</a>`;
                } else if (lowerUrl.match(/\.(jpeg|jpg|gif|png|webp)$/i) || (lowerUrl.includes('supabase.co') && lowerUrl.includes('/storage/v1/object/public/evidence/'))) {
                    mediaHtml += `<img src="${url}" class="media-preview-img" alt="Evidence" loading="lazy">`;
                } else {
                    mediaHtml += `<a href="${url}" target="_blank" class="evidence-link-box"><i class="fa-solid fa-link"></i> ${url.substring(0, 40)}...</a>`;
                }
            });
            mediaHtml += `</div>`;
        }

        if (claim.status === 'RESOLVED') {
            mediaHtml += `
                <div style="margin-top: 1rem;">
                    <div class="view-proof-btn" onclick="openProofModal('${claim.id}')">
                        <i class="fa-solid fa-user-shield"></i> View Validator Proof
                    </div>
                </div>
            `;
        }

        let myVoteStatus = null;
        if(globalDbVotes) {
            const myVoteRecord = globalDbVotes.find(v => v.claim_id === claim.id);
            if (myVoteRecord) myVoteStatus = myVoteRecord.vote_type;
        }

        const commentCount = claim.comments ? claim.comments.length : 0;
        const commentCountDisplay = commentCount > 0 ? `(${commentCount})` : '';

        const isUpvoted = myVoteStatus === 'up' ? 'upvote-active' : '';
        const isDownvoted = myVoteStatus === 'down' ? 'downvote-active' : '';
        const isBookmarked = localBookmarks.includes(claim.id) ? 'bookmarked-active' : '';
        
        const isAuthor = claim.author_id === currentUser.id;
        
        const validateBtn = (currentUserRole === 'validator' && claim.status !== 'RESOLVED') ? `<div class="post-action validate-action" onclick="openValidateModal('${claim.id}')"><i class="fa-solid fa-shield-halved"></i> Validate</div>` : '';
        
        const delay = index * 0.1;
        const displayName = claim.author?.display_name || `User_${claim.author_id.substring(0,6)}`;
        const displayAvatar = claim.author?.profile_pic_url || 'https://via.placeholder.com/50';

        const deleteOption = isAuthor ? `<div class="dropdown-item danger" onclick="deleteClaim('${claim.id}')"><i class="fa-solid fa-trash"></i> Delete Post</div>` : '';
        
        const optionsMenu = `
            <div class="post-options-wrap">
                <button class="icon-btn-small" onclick="toggleDropdown('${claim.id}')"><i class="fa-solid fa-ellipsis"></i></button>
                <div class="dropdown-menu" id="dropdown-${claim.id}">
                    <div class="dropdown-item" onclick="sharePost('${claim.id}')"><i class="fa-solid fa-share-nodes"></i> Copy Link</div>
                    ${deleteOption}
                </div>
            </div>
        `;

        const html = `
            <article class="interactive-card post-card slide-up ${trendingClass}" id="claim-${claim.id}" style="animation-delay: ${delay}s;">
                <div class="post-header">
                    <div class="post-meta">
                        <img src="${displayAvatar}" alt="Avatar">
                        <div class="post-author">
                            <strong>${displayName}</strong>
                            <span>${new Date(claim.created_at).toLocaleDateString()}</span>
                        </div>
                    </div>
                    <div class="header-right">
                        ${trendingBadge}
                        <div class="verdict-badge ${verdictClass}"><i class="fa-solid ${verdictIcon}"></i> ${statusText}</div>
                        ${optionsMenu}
                    </div>
                </div>
                
                <div class="post-content-wrap">
                    <div class="tags-wrap">${tagsHtml}</div>
                    <h3 class="post-title">${claim.content}</h3>
                    ${mediaHtml}
                </div>
                
                <div class="post-footer">
                    <div class="post-action ${isUpvoted}" id="upvote-btn-${claim.id}" onclick="castVote('${claim.id}', 'up')">
                        <i class="fa-solid fa-arrow-up"></i> <span id="upvote-count-${claim.id}">${claim.upvotes || 0}</span>
                    </div>
                    <div class="post-action ${isDownvoted}" id="downvote-btn-${claim.id}" onclick="castVote('${claim.id}', 'down')">
                        <i class="fa-solid fa-arrow-down"></i> <span id="downvote-count-${claim.id}">${claim.downvotes || 0}</span>
                    </div>
                    <div class="post-action" onclick="openCommentModal('${claim.id}')">
                        <i class="fa-solid fa-comment"></i> Comment <span id="comment-count-${claim.id}" style="margin-left: 2px;">${commentCountDisplay}</span>
                    </div>
                    <div class="post-action ${isBookmarked}" id="bookmark-btn-${claim.id}" onclick="toggleBookmark('${claim.id}')">
                        <i class="fa-solid fa-bookmark"></i>
                    </div>
                    ${validateBtn}
                </div>
            </article>
        `;
        feedContainer.insertAdjacentHTML('beforeend', html);
    });
}