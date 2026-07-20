# Git and GitHub for Complete Beginners

A step-by-step guide to installing Git and connecting it to GitHub. No technical experience needed.

---

## Part 1: What are Git and GitHub?

**Git** is a free program that runs on your computer. It keeps track of changes you make to files, like a very powerful "undo" history. It also lets you save snapshots of your work, so you can always go back to an earlier version.

**GitHub** is a website (github.com) where you can store a copy of your Git projects online. This keeps your work safe if your computer breaks, and lets you share your work or team up with other people.

Think of it this way:

- **Git** = the tool on your computer that tracks your work.
- **GitHub** = the website where you keep an online backup of that work.

You need both, and this guide sets up both.

---

## Part 2: Create a GitHub account (everyone does this first)

1. Open your web browser and go to **https://github.com**
2. Click the **Sign up** button (top right corner).
3. Enter your email address, then follow the prompts to choose a password and a username.
   - Your username will be public. Pick something you are happy for others to see.
4. GitHub will send a code to your email. Type it in to confirm your account.
5. If GitHub asks questions like "How many people will you work with?", you can pick any answer or skip. Choose the **Free** plan when asked.

That's it. You now have a GitHub account. Keep your username and password somewhere safe.

---

## Part 3: Install Git on macOS

### Step 1: Open the Terminal

The Terminal is an app where you type commands instead of clicking buttons. Don't worry, you only need to type a few short things.

1. Press **Command (⌘) + Space** to open Spotlight search.
2. Type **Terminal** and press **Enter**.
3. A window with text appears. This is the Terminal.

### Step 2: Check if Git is already installed

In the Terminal window, type this exactly and press **Enter**:

```
git --version
```

Two things can happen:

- **You see something like `git version 2.39.3`** — Git is already installed. Skip to Step 3.
- **A pop-up window appears** saying the "command line developer tools" need to be installed. Click **Install**, agree to the terms, and wait for it to finish (this can take 5–15 minutes). When it's done, type `git --version` again to confirm you see a version number.

### Step 3: Tell Git who you are

Git labels every snapshot you save with your name and email. Set these once by typing the two commands below, one at a time, pressing **Enter** after each. Replace the example name and email with your own (keep the quotation marks):

```
git config --global user.name "Your Name"
```

```
git config --global user.email "you@example.com"
```

**Tip:** Use the same email address you used for your GitHub account. This links your saved work to your GitHub profile.

To check it worked, type:

```
git config --global user.name
```

It should print the name you just entered. Git is now set up on your Mac. Jump to **Part 5** to connect it to GitHub.

---

## Part 4: Install Git on Windows

### Step 1: Download Git for Windows

1. Open your web browser and go to **https://git-scm.com/download/win**
2. The download usually starts automatically. If not, click the link for **64-bit Git for Windows Setup**.
3. When the download finishes, open the file (it will be called something like `Git-2.xx.x-64-bit.exe`).

### Step 2: Run the installer

1. If Windows asks "Do you want to allow this app to make changes?", click **Yes**.
2. The installer shows many screens with options. **You do not need to change anything.** Just click **Next** on every screen, then **Install** at the end.
3. When it finishes, click **Finish**.

The default options are sensible and include a helper that makes signing in to GitHub easy later.

### Step 3: Open Git Bash

The installer added a program called **Git Bash**. This is the window where you type Git commands.

1. Click the **Start** button (Windows logo).
2. Type **Git Bash** and press **Enter**.
3. A window with text appears. This is where you'll type commands.

### Step 4: Check Git installed correctly

In the Git Bash window, type this and press **Enter**:

```
git --version
```

You should see something like `git version 2.45.1.windows.1`. If you do, Git is installed.

### Step 5: Tell Git who you are

Git labels every snapshot you save with your name and email. Set these once by typing the two commands below, one at a time, pressing **Enter** after each. Replace the example name and email with your own (keep the quotation marks):

```
git config --global user.name "Your Name"
```

```
git config --global user.email "you@example.com"
```

**Tip:** Use the same email address you used for your GitHub account. This links your saved work to your GitHub profile.

To check it worked, type:

```
git config --global user.name
```

It should print the name you just entered. Git is now set up on your PC. Continue to **Part 5**.

---

## Part 5: Connect Git to GitHub (test everything works)

The best way to check your setup is to do one small project from start to finish. This takes about 10 minutes.

**A quick note about the word "repository":** a repository (or "repo") is just Git's word for a project folder that Git is tracking.

### Step 1: Create a repository on GitHub

1. Go to **https://github.com** and sign in.
2. Click the **+** button in the top right corner, then click **New repository**.
3. In **Repository name**, type: `hello-world`
4. Tick the box that says **Add a README file**.
5. Click the green **Create repository** button at the bottom.

You now have a project stored on GitHub.

### Step 2: Copy the repository's address

1. On your new repository's page, click the green **Code** button.
2. Make sure the **HTTPS** tab is selected.
3. Click the copy icon next to the address (it looks like `https://github.com/yourusername/hello-world.git`).

### Step 3: Download (clone) the repository to your computer

Open your command window:

- **macOS:** open **Terminal** (Command + Space, type Terminal, press Enter).
- **Windows:** open **Git Bash** (Start button, type Git Bash, press Enter).

Type the following, but replace the address with the one you copied. To paste:

- **macOS Terminal:** press **Command + V**
- **Windows Git Bash:** **right-click** in the window and choose **Paste**

```
git clone https://github.com/yourusername/hello-world.git
```

Press **Enter**. Git downloads the project into a new folder called `hello-world` inside your home folder.

Now move into that folder by typing:

```
cd hello-world
```

### Step 4: Make a small change

Type this command to add a line of text to the README file:

```
echo "My first change" >> README.md
```

(This quietly adds the words "My first change" to the file. Nothing appears on screen — that's normal.)

### Step 5: Save the change with Git

Saving in Git is two steps: first you choose what to save, then you save it with a short message.

```
git add README.md
```

```
git commit -m "My first commit"
```

The word **commit** just means "a saved snapshot". The text in quotes is a note to your future self about what you changed.

### Step 6: Send the change up to GitHub

```
git push
```

**The first time you push, you'll be asked to sign in:**

- **Windows:** a window pops up. Choose **Sign in with your browser**, and your web browser opens. Sign in to GitHub and click **Authorize**. You only need to do this once — your PC remembers it.
- **macOS:** you may be asked for a username and password in the Terminal. GitHub no longer accepts your normal account password here — it needs a special code called a **personal access token**. To get one:
  1. In your browser, go to **https://github.com/settings/tokens**
  2. Click **Generate new token**, then choose **Generate new token (classic)**.
  3. Give it a name (like "my laptop"), set an expiry (90 days is fine), and tick the box next to **repo**.
  4. Click **Generate token** at the bottom, then **copy the long code** it shows you (you only get to see it once).
  5. Back in the Terminal: type your GitHub **username**, press Enter, then paste the **token** as the password and press Enter. (The password stays invisible while you type or paste — that's normal. Just paste and press Enter.)
  6. Your Mac will remember it in its Keychain, so you won't need to do this every time.

### Step 7: Check it worked

Go back to your repository page on github.com and refresh the page. Click on **README.md**. You should see the line **"My first change"**.

**Congratulations — everything is working.** You have:

- ✅ Git installed on your computer
- ✅ A GitHub account
- ✅ The two connected, with a real change saved and uploaded

---

## Part 6: The five commands you'll use every day

You don't need to memorise much. Almost all everyday Git use is these five commands, in this order:

| Command | What it does |
|---|---|
| `git pull` | Downloads the latest version from GitHub (do this before you start working) |
| `git status` | Shows which files you've changed |
| `git add .` | Chooses **all** your changed files to be saved |
| `git commit -m "describe your change"` | Saves a snapshot with a short note |
| `git push` | Uploads your saved snapshots to GitHub |

A normal working session looks like: **pull → make changes → add → commit → push**.

---

## Common problems and fixes

**"git: command not found"**
Git isn't installed yet, or the window needs restarting. Close the Terminal/Git Bash window, open it again, and try `git --version`. If it still fails, redo the install steps for your system.

**"Permission denied" or "Authentication failed" when pushing**
Your sign-in didn't work. On Windows, try `git push` again and use the browser sign-in option. On macOS, your token may have expired — create a new one (Part 5, Step 6) and try again.

**"fatal: not a git repository"**
You're in the wrong folder. Type `cd hello-world` (or the name of your project folder) first, then try again.

**I typed a command and nothing happened**
That's often normal — many Git commands succeed silently. Type `git status` to see where things stand.

**I closed the window — is my work gone?**
No. Everything you committed is saved on your computer, and everything you pushed is also saved on GitHub.

---

## What to learn next

Once you're comfortable with the five daily commands, the next useful ideas are:

- **Branches** — working on a copy of your project so experiments don't break the main version.
- **Pull requests** — GitHub's way of proposing and reviewing changes, used heavily in teams.
- **.gitignore** — a small file that tells Git which files to skip (like temporary files).

GitHub's own beginner tutorials at **https://docs.github.com/en/get-started** are free and well written.
