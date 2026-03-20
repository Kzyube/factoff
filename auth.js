const supabaseUrl = 'https://emnydyqwsmdxggepotlv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtbnlkeXF3c21keGdnZXBvdGx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5Nzg5MzIsImV4cCI6MjA4OTU1NDkzMn0.rtG9j5qUm5Tr0YolFDA6VubafWNK4M0TdvFBWqDcWEs';
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

let cropper;
let finalCroppedBlob = null;

window.onload = async () => {
    document.getElementById('avatar-preview-box').classList.add('needs-photo');
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) window.location.href = 'index.html'; 
};

function switchView(viewId) {
    document.querySelectorAll('.page-view').forEach(v => {
        v.classList.remove('active');
    });
    
    setTimeout(() => {
        const view = document.getElementById(viewId);
        view.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' }); 
    }, 50);
}

function selectRole(role) {
    // Updates UI for the selected role
    document.querySelectorAll('.role-card').forEach(btn => btn.classList.remove('selected'));
    document.querySelector(`[data-role="${role}"]`).classList.add('selected');
    document.getElementById('selected-role').value = role;

    // Triggers the Fluid Gradient Slider
    document.getElementById('role-selector-wrap').setAttribute('data-active', role);

    // Shows/Hides the Validator Certificate Requirement
    const certGroup = document.getElementById('certification-group');
    const certInput = document.getElementById('cert-file');
    if (role === 'validator') {
        certGroup.classList.remove('hidden');
        certInput.setAttribute('required', 'true');
    } else {
        certGroup.classList.add('hidden');
        certInput.removeAttribute('required');
    }
}

// --- CROPPER LOGIC ---
document.getElementById('profile-pic').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            document.getElementById('image-to-crop').src = event.target.result;
            document.getElementById('cropper-modal').classList.add('active');
            
            if (cropper) cropper.destroy(); 
            cropper = new Cropper(document.getElementById('image-to-crop'), {
                aspectRatio: 1, 
                viewMode: 1,
                dragMode: 'move',
                autoCropArea: 1,
            });
        };
        reader.readAsDataURL(file);
    }
});

function closeCropper() {
    document.getElementById('cropper-modal').classList.remove('active');
    if(!finalCroppedBlob) document.getElementById('profile-pic').value = '';
}

function applyCrop() {
    if (!cropper) return;
    const canvas = cropper.getCroppedCanvas({ width: 400, height: 400 });
    
    canvas.toBlob((blob) => {
        finalCroppedBlob = blob; 
        const previewImg = document.getElementById('final-avatar-img');
        previewImg.src = URL.createObjectURL(blob);
        previewImg.style.display = 'block';
        document.getElementById('cam-icon').style.display = 'none';
        document.getElementById('avatar-preview-box').classList.remove('needs-photo');
        closeCropper();
    }, 'image/jpeg', 0.9);
}

// --- REGISTRATION LOGIC ---
document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('reg-btn');
    btn.innerText = "Processing...";
    btn.disabled = true;
    
    const displayName = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const role = document.getElementById('selected-role').value;
    const certFile = document.getElementById('cert-file').files[0];

    if (!role) { alert("Please select your path."); btn.disabled=false; btn.innerText="Complete Registration"; return; }
    if (!finalCroppedBlob) { alert("Please upload a profile picture."); btn.disabled=false; btn.innerText="Complete Registration"; return; }

    try {
        const { data: authData, error: authError } = await supabaseClient.auth.signUp({ 
            email, 
            password, 
            options: { 
                data: { 
                    user_role: role,
                    display_name: displayName 
                } 
            }
        });
        if (authError) throw authError;

        const userId = authData.user.id;
        let profilePicUrl = null;
        let certUrl = null;

        const avatarPath = `${userId}/avatar_${Date.now()}.jpg`;
        await supabaseClient.storage.from('avatars').upload(avatarPath, finalCroppedBlob);
        profilePicUrl = supabaseClient.storage.from('avatars').getPublicUrl(avatarPath).data.publicUrl;

        if (role === 'validator' && certFile) {
            const certPath = `${userId}/cert_${Date.now()}_${certFile.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
            await supabaseClient.storage.from('certs').upload(certPath, certFile);
            certUrl = supabaseClient.storage.from('certs').getPublicUrl(certPath).data.publicUrl;
        }

        // FIX: WE NOW SAVE THE DISPLAY_NAME DIRECTLY TO THE PUBLIC TABLE HERE
        await supabaseClient.from('users').update({ 
            profile_pic_url: profilePicUrl, 
            cert_url: certUrl,
            display_name: displayName
        }).eq('id', userId);

        window.location.href = 'index.html';

    } catch (error) {
        alert("Registration Error: " + error.message);
        btn.innerText = "Complete Registration";
        btn.disabled = false;
    }
});

// --- LOGIN LOGIC ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    btn.innerText = "Authenticating...";
    btn.disabled = true;

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = 'index.html'; 
    } catch (error) {
        alert("Login Error: " + error.message);
        btn.innerText = "Sign In";
        btn.disabled = false;
    }
});