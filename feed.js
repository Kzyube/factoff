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
let lastAddedCommentId = null; 
window.currentLoadedComments = []; // Stores comments in memory for the AI to read

// 🤖 NEW: AI Conversational Memory Array
let aiChatHistory = [];

// Local memory for Comment Votes
let localCommentVotes = JSON.parse(localStorage.getItem('factoff_comment_votes') || '{}');

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

// --- LIGHTBOX ENGINE ---
window.openLightbox = (url) => {
    document.getElementById('lightbox-img').src = url;
    document.getElementById('lightbox-modal').classList.add('active');
};
window.closeLightbox = () => {
    document.getElementById('lightbox-modal').classList.remove('active');
    document.getElementById('lightbox-img').src = '';
};

// --- GLOBAL CLICK LISTENER ---
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

// --- POST VOTING SYSTEM ---
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

// --- FACEBOOK STYLE COMMENTS, REPLIES, VOTES & ANIMATIONS ---
const commentModal = document.getElementById('comment-modal');
const commentFilePreview = document.getElementById('comment-media-preview');
const commentFileInput = document.getElementById('comment-file-upload');

let currentReplyParentId = null;

window.setReply = function(commentId, userName) {
    currentReplyParentId = commentId;
    document.getElementById('replying-to-name').innerText = userName;
    
    const indicator = document.getElementById('replying-to-indicator');
    indicator.style.display = 'flex';
    indicator.classList.remove('show-indicator');
    void indicator.offsetWidth; 
    indicator.classList.add('show-indicator');

    document.getElementById('comment-input').focus();

    document.querySelectorAll('.comment-bubble').forEach(b => b.classList.remove('reply-highlight'));
    const targetBubble = document.getElementById(`comment-bubble-${commentId}`);
    if (targetBubble) {
        targetBubble.classList.add('reply-highlight');
        targetBubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

window.cancelReply = function() {
    currentReplyParentId = null;
    document.getElementById('replying-to-indicator').style.display = 'none';
    document.querySelectorAll('.comment-bubble').forEach(b => b.classList.remove('reply-highlight'));
};

window.castCommentVote = async (commentId, type) => {
    const upBtn = document.getElementById(`c-up-${commentId}`);
    const downBtn = document.getElementById(`c-down-${commentId}`);
    const countEl = document.getElementById(`c-count-${commentId}`);
    let currentScore = parseInt(countEl.innerText) || 0;

    const myVote = localCommentVotes[commentId]; 

    if (myVote === type) {
        currentScore += (type === 'up' ? -1 : 1);
        localCommentVotes[commentId] = null;
        if(type==='up') upBtn.classList.remove('up-active');
        if(type==='down') downBtn.classList.remove('down-active');
    } else {
        if (myVote === 'up') currentScore -= 1;
        if (myVote === 'down') currentScore += 1;

        currentScore += (type === 'up' ? 1 : -1);
        localCommentVotes[commentId] = type;

        if(type==='up') { upBtn.classList.add('up-active'); downBtn.classList.remove('down-active'); }
        if(type==='down') { downBtn.classList.add('down-active'); upBtn.classList.remove('up-active'); }
    }

    countEl.innerText = currentScore;
    localStorage.setItem('factoff_comment_votes', JSON.stringify(localCommentVotes));

    const { data } = await supabaseClient.from('comments').select('upvotes, downvotes').eq('id', commentId).single();
    if(data) {
        let u = data.upvotes || 0; let d = data.downvotes || 0;
        if (myVote === type) {
            if (type === 'up') u--; else d--;
        } else {
            if (myVote === 'up') u--;
            if (myVote === 'down') d--;
            if (type === 'up') u++; else d++;
        }
        await supabaseClient.from('comments').update({ upvotes: u, downvotes: d }).eq('id', commentId);
    }
};

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
    document.getElementById('comment-modal').classList.add('active'); 
    
    const originalPostNode = document.getElementById(`claim-${claimId}`);
    document.getElementById('comment-original-post').innerHTML = originalPostNode.innerHTML;
    document.getElementById('comment-original-post').querySelector('.post-footer').style.display = 'none';

    loadComments();
};

window.closeCommentModal = () => {
    document.getElementById('comment-modal').classList.remove('active');
    document.getElementById('comment-input').value = '';
    if(commentFileInput) commentFileInput.value = '';
    if(commentFilePreview) commentFilePreview.style.display = 'none';
    cancelReply(); 
};

async function loadComments() {
    const list = document.getElementById('comments-list');
    
    if(!lastAddedCommentId) list.innerHTML = `<div class="spinner" style="margin: 0 auto;"></div>`;

    const { data: comments } = await supabaseClient.from('comments')
        .select('*, users(display_name, profile_pic_url)')
        .eq('claim_id', currentActiveClaimId)
        .order('created_at', { ascending: true });

    list.innerHTML = '';
    if(!comments || comments.length === 0) {
        list.innerHTML = `<p style="text-align:center; color:var(--text-muted);">No comments yet. Be the first to start the discussion!</p>`;
        return;
    }

    // Save fetched comments into memory for the AI to read if needed
    window.currentLoadedComments = comments;

    const topLevel = comments.filter(c => !c.parent_id);
    const replies = comments.filter(c => c.parent_id);

    const renderComment = (c, isReply = false) => {
        const name = c.users?.display_name || "User";
        const avatar = c.users?.profile_pic_url || 'https://via.placeholder.com/35';
        const timeString = new Date(c.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        let media = '';
        if (c.media_url) {
            const lowUrl = c.media_url.toLowerCase();
            if (lowUrl.includes('.pdf')) {
                media = `<a href="${c.media_url}" target="_blank" class="evidence-link-box" style="margin-top: 10px;"><i class="fa-solid fa-file-pdf" style="color: var(--danger); font-size: 1.2rem;"></i> View Attached PDF</a>`;
            } else if (lowUrl.match(/\.(doc|docx|ppt|pptx|xls|xlsx)$/i)) {
                media = `<a href="${c.media_url}" target="_blank" class="evidence-link-box" style="margin-top: 10px;"><i class="fa-solid fa-file-word" style="color: var(--primary); font-size: 1.2rem;"></i> Download Document</a>`;
            } else {
                media = `<img src="${c.media_url}" class="comment-media-img" onclick="openLightbox('${c.media_url}')">`;
            }
        }
        
        let bubbleClass = isReply ? "reply-bubble" : "";
        if (c.id === lastAddedCommentId) bubbleClass += " new-comment-anim"; 
        
        const replyAction = !isReply 
            ? `<button class="comment-action-btn" onclick="window.setReply('${c.id}', '${name.replace(/'/g, "\\'")}')">Reply</button>` 
            : '';
            
        // 🤖 NEW AI BUTTON FOR EACH COMMENT
        const aiAction = `<button class="comment-action-btn" style="color: var(--primary);" onclick="openAiChat('comment', '${c.id}')"><i class="fa-solid fa-robot"></i> Ask AI</button>`;

        let netScore = (c.upvotes || 0) - (c.downvotes || 0);
        let myVote = localCommentVotes[c.id];
        let upClass = myVote === 'up' ? 'up-active' : '';
        let downClass = myVote === 'down' ? 'down-active' : '';

        const votesHtml = `
            <div class="comment-votes-wrap">
                <button class="comment-vote-btn ${upClass}" id="c-up-${c.id}" onclick="castCommentVote('${c.id}', 'up')"><i class="fa-solid fa-arrow-up"></i></button>
                <span class="comment-vote-count" id="c-count-${c.id}">${netScore}</span>
                <button class="comment-vote-btn ${downClass}" id="c-down-${c.id}" onclick="castCommentVote('${c.id}', 'down')"><i class="fa-solid fa-arrow-down"></i></button>
            </div>
        `;

        return `
            <div class="comment-bubble ${bubbleClass}" id="comment-bubble-${c.id}">
                <img src="${avatar}">
                <div style="flex:1;">
                    <div class="comment-content-box">
                        <strong>${name}</strong>
                        <p style="white-space: pre-wrap;">${c.content}</p>
                        ${media}
                    </div>
                    <div class="comment-action-links">
                        ${votesHtml}
                        <span class="comment-time">${timeString}</span>
                        ${replyAction}
                        ${aiAction}
                    </div>
                </div>
            </div>
        `;
    };

    topLevel.forEach(c => {
        list.innerHTML += renderComment(c, false);
        const childReplies = replies.filter(r => r.parent_id === c.id);
        childReplies.forEach(r => {
            list.innerHTML += renderComment(r, true);
        });
    });

    if (lastAddedCommentId) {
        setTimeout(() => {
            const bodyScroll = document.getElementById('comment-modal-body');
            bodyScroll.scrollTo({ top: bodyScroll.scrollHeight, behavior: 'smooth' });
            lastAddedCommentId = null; 
        }, 100);
    }
}

document.getElementById('comment-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') submitComment();
});

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

        const { data: inserted } = await supabaseClient.from('comments').insert([{
            claim_id: currentActiveClaimId, 
            user_id: currentUser.id, 
            content: content || "Attached a file.", 
            media_url: mediaUrl,
            parent_id: currentReplyParentId 
        }]).select();

        if(inserted && inserted[0]) lastAddedCommentId = inserted[0].id; 

        const countSpan = document.getElementById(`comment-count-${currentActiveClaimId}`);
        if (countSpan && !currentReplyParentId) { 
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
        
        cancelReply(); 
        loadComments(); 

    } catch (e) {
        alert("Error posting comment: " + e.message);
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
                modalHtml += `<img src="${url}" class="media-preview-img" alt="Validator Evidence" loading="lazy" onclick="openLightbox('${url}')">`;
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
    
    // 💡 NEW: We fetch the author's Role and Trust Score so the AI can profile them!
    let query = supabaseClient.from('claims').select('*, author:users!author_id (profile_pic_url, display_name, role, trust_score), comments(id)').order('created_at', { ascending: false });
    
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
                    mediaHtml += `<img src="${url}" class="media-preview-img" alt="Evidence" loading="lazy" onclick="openLightbox('${url}')">`;
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
        
        // 🤖 NEW AI BUTTON FOR EACH POST
        const aiBtn = `<div class="post-action ai-action" onclick="openAiChat('claim', '${claim.id}')"><i class="fa-solid fa-robot"></i> Ask AI</div>`;

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
                    ${aiBtn}
                </div>
            </article>
        `;
        feedContainer.insertAdjacentHTML('beforeend', html);
    });
}

// --- 🤖 SIMULATED SUPER-SMART AI ENGINE (Options 1, 2, 3, & 4 Combined) ---
let currentAiContext = {};

window.openAiChat = (type, id) => {
    // 💡 NEW: Reset the Conversational Memory every time you open a new chat!
    aiChatHistory = [];
    
    let contextText = "";
    let meta = {};
    
    if (type === 'claim') {
        const claim = allFetchedClaims.find(x => x.id === id);
        contextText = claim ? claim.content : "";
        meta = {
            id: id,
            author: claim?.author?.display_name || "Unknown User",
            authorRole: claim?.author?.role || "participant",
            trustScore: claim?.author?.trust_score || 0,
            tags: claim?.tags || [],
            upvotes: claim?.upvotes || 0,
            downvotes: claim?.downvotes || 0,
            status: claim?.status || "UNRESOLVED",
            verdict: claim?.verdict || "NONE",
            evidenceUrls: claim?.evidence_urls || [],
            comments: window.currentLoadedComments.filter(c => c.claim_id === id).map(c => c.content)
        };
    } else if (type === 'comment') {
        const c = window.currentLoadedComments.find(x => x.id === id);
        contextText = c ? c.content : "";
        meta = {
            id: id,
            author: c?.users?.display_name || "Unknown User",
            authorRole: c?.users?.role || "participant",
            trustScore: c?.users?.trust_score || 0,
            upvotes: c?.upvotes || 0,
            downvotes: c?.downvotes || 0,
            evidenceUrls: c?.media_url ? [c.media_url] : []
        };
    }
    
    currentAiContext = { type, text: contextText, meta };
    document.getElementById('ai-chat-sidebar').classList.add('active');
    
    const msgBox = document.getElementById('ai-chat-messages');
    msgBox.innerHTML = ''; 
    
    msgBox.innerHTML += `
        <div class="chat-msg ai-message">
            <strong><i class="fa-solid fa-robot"></i> FactOff AI</strong><br><br>
            I have read the ${type} you selected. How can I help you analyze it?
        </div>
    `;
    
    setTimeout(() => { msgBox.scrollTo({ top: msgBox.scrollHeight, behavior: 'smooth' }); }, 50);
};

window.closeAiChat = () => {
    document.getElementById('ai-chat-sidebar').classList.remove('active');
};

// 🧠 THE MASTER BRAIN
function simulateAIResponse(question, contextObj) {
    const q = question.toLowerCase();
    const cText = contextObj.text.toLowerCase();
    const meta = contextObj.meta;
    
    // 💡 NEW: Conversational Memory check
    const lastQ = aiChatHistory.length > 0 ? aiChatHistory[aiChatHistory.length - 1].toLowerCase() : "";
    
    let response = "";

    // 💡 NLP EXTRACTION
    let doc = typeof nlp !== 'undefined' ? nlp(contextObj.text) : null;
    let people = doc ? doc.people().out('array') : [];
    let orgs = doc ? doc.organizations().out('array') : [];
    let topics = doc ? doc.nouns().out('array').filter(n => n.length > 4).slice(0, 3) : [];

    const redFlags = ["won't believe", "hiding this", "100% proven", "secret", "miracle", "shocking", "click here"];
    let foundFlags = redFlags.filter(flag => cText.includes(flag));

    let similarCount = 0;
    let resolvedFakeCount = 0;
    if (topics.length > 0 && allFetchedClaims.length > 0) {
        let similar = allFetchedClaims.filter(claim => 
            claim.id !== meta.id && 
            topics.some(t => claim.content.toLowerCase().includes(t.toLowerCase()))
        );
        similarCount = similar.length;
        resolvedFakeCount = similar.filter(cl => cl.verdict === 'FAKE').length;
    }

    // --- SMART LOGIC ROUTING ---

    // 💡 NEW: Domain Authority Scanner Logic
    if (q.includes('source') || q.includes('link') || q.includes('evidence')) {
        if (meta.evidenceUrls && meta.evidenceUrls.length > 0) {
            response += "I've analyzed the attached evidence. ";
            let social = meta.evidenceUrls.filter(u => u.includes('tiktok.com') || u.includes('twitter.com') || u.includes('facebook.com') || u.includes('youtube.com') || u.includes('instagram.com'));
            let credible = meta.evidenceUrls.filter(u => u.includes('.gov') || u.includes('.edu') || u.includes('reuters') || u.includes('apnews') || u.includes('bbc.com'));
            
            if (social.length > 0) {
                response += `I noticed links pointing to social media platforms. Social platforms are not primary sources and are highly prone to misinformation. `;
            }
            if (credible.length > 0) {
                response += `I see a highly credible domain in the evidence, which strongly increases the likelihood of this being factual. `;
            }
            if (social.length === 0 && credible.length === 0) {
                response += `The provided links are standard web domains. I recommend cross-referencing them with established news outlets or databases.`;
            }
        } else {
            response += "The author has not attached any external links or documents to verify this claim.";
        }
    }
    // 💡 NEW: Comment Section Sentiment Logic
    else if (q.includes('comment') || q.includes('community') || q.includes('people say')) {
        if (meta.comments && meta.comments.length > 0) {
            let commentText = meta.comments.join(" ").toLowerCase();
            let skeptical = (commentText.match(/fake|photoshop|untrue|source\?|doubt|debunked|false/g) || []).length;
            let agreeing = (commentText.match(/real|true|agree|confirmed|legit|fact/g) || []).length;
            
            response += `I've read through the ${meta.comments.length} comments loaded for this item. `;
            if (skeptical > agreeing) {
                response += `The community seems highly skeptical, with multiple users pointing out flaws or calling it fake.`;
            } else if (agreeing > skeptical) {
                response += `The community generally agrees with this claim so far.`;
            } else {
                response += `The community is currently divided or discussing it neutrally. There is no clear consensus yet.`;
            }
        } else {
            response += "I don't have enough comment data loaded for this specific item right now. Try opening the comment section first so I can read it!";
        }
    }
    // 💡 NEW: Author Reputation Profiling Logic
    else if (q.includes('author') || q.includes('who') || q.includes('trust')) {
        response += `This ${contextObj.type} was posted by <strong>${meta.author}</strong>. `;
        if (meta.authorRole === 'validator') {
            response += `They are a verified <strong>Truth Veteran (Validator)</strong> with a trust score of ${meta.trustScore}. Their claims generally hold significantly more weight on the Grid.`;
        } else {
            response += `They are registered as a standard 'Participant' with a trust score of ${meta.trustScore}. Since they do not hold Validator credentials, I recommend scrutinizing their evidence closely.`;
        }
    }
    // Real / Fake / Legit
    else if (q.includes('real') || q.includes('fake') || q.includes('true') || q.includes('false') || q.includes('legit')) {
        response += `Looking at the metadata, this ${contextObj.type} was posted by <strong>${meta.author}</strong>. `;
        
        if (contextObj.type === 'claim' && meta.status === 'RESOLVED') {
            response += `This claim has already been officially validated as <strong>${meta.verdict}</strong> by our Truth Veterans. `;
        } else {
            response += `It is currently <strong>UNRESOLVED</strong>. The community sentiment shows ${meta.upvotes} upvotes and ${meta.downvotes} downvotes. `;
        }

        if (resolvedFakeCount > 0) {
            response += `<br><br><em><i class="fa-solid fa-database"></i> Hive Mind Alert:</em> I found ${resolvedFakeCount} similar claims in our database that were previously proven <strong>FAKE</strong>. Please proceed with extreme caution. `;
        } else if (similarCount > 0) {
            response += `<br><br><em><i class="fa-solid fa-database"></i> Hive Mind Info:</em> There are ${similarCount} other claims in our grid discussing similar topics.`;
        }
    } 
    else if (q.includes('summarize') || q.includes('what is this') || q.includes('explain') || q.includes('mean')) {
        response += `Here is my analysis of the ${contextObj.type}:<br><br>`;
        
        if (people.length > 0 || orgs.length > 0) {
            response += `<strong>Key Entities Detected:</strong> ${[...people, ...orgs].join(', ')}.<br>`;
        }
        if (contextObj.type === 'claim' && meta.tags && meta.tags.length > 0) {
            response += `<strong>Categorized As:</strong> ${meta.tags.join(', ')}.<br>`;
        }
        if (topics.length > 0) {
            response += `<strong>Core Topics:</strong> ${topics.join(', ')}.<br><br>`;
        }
        
        response += `The community currently has a net trust score of ${meta.upvotes - meta.downvotes} on this item.`;
    }
    else {
        // 💡 NEW: Conversational Memory Fallback
        if ((q.includes('what about') || q.includes('why')) && lastQ) {
            response += `Regarding your previous question about "${lastQ}"... `;
        }
        
        response += `Based on my analysis of this ${contextObj.type} by ${meta.author}, the community sentiment is currently sitting at ${meta.upvotes} upvotes and ${meta.downvotes} downvotes. `;
        if (topics.length > 0) {
            response += `The core subjects appear to be ${topics.join(' and ')}. `;
        }
        response += `What specific evidence, source, or comment would you like me to evaluate next?`;
    }

    // Always Append Red Flags
    if (foundFlags.length > 0) {
        response += `<br><br><span style="color: var(--danger);"><strong><i class="fa-solid fa-triangle-exclamation"></i> Warning:</strong> My NLP scanners detected potential clickbait terminology in the text: <em>"${foundFlags.join(', ')}"</em>. This is a common tactic used in misinformation.</span>`;
    }

    return response;
}

window.sendAiMessage = () => {
    const input = document.getElementById('ai-chat-input');
    const msg = input.value.trim();
    if (!msg) return;

    const msgBox = document.getElementById('ai-chat-messages');
    msgBox.innerHTML += `<div class="chat-msg user-message">${msg}</div>`;
    input.value = '';
    msgBox.scrollTo({ top: msgBox.scrollHeight, behavior: 'smooth' });

    const loadId = 'ai-load-' + Date.now();
    msgBox.innerHTML += `<div class="chat-msg ai-message" id="${loadId}"><i class="fa-solid fa-circle-notch fa-spin"></i> Analyzing context...</div>`;
    msgBox.scrollTo({ top: msgBox.scrollHeight, behavior: 'smooth' });

    // Simulate network delay and thinking time (1.5 seconds)
    setTimeout(() => {
        document.getElementById(loadId).remove();
        
        const reply = simulateAIResponse(msg, currentAiContext);
        
        // 💡 NEW: Save the user's question to the AI's short-term memory
        aiChatHistory.push(msg);
        if(aiChatHistory.length > 3) aiChatHistory.shift(); // Keep memory lightweight

        msgBox.innerHTML += `<div class="chat-msg ai-message"><strong><i class="fa-solid fa-robot"></i> FactOff AI</strong><br><br>${reply}</div>`;
        msgBox.scrollTo({ top: msgBox.scrollHeight, behavior: 'smooth' });
    }, 1500); 
};