const loginForm = document.getElementById("loginForm");

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(loginForm);
    const data = {
        email: formData.get("email"),
        password: formData.get("password"),
    };

    try {
        //create response and structure
        const response = await fetch("http://127.0.0.1:8000/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        });
        const result = await response.json(); //take result and turn into json format
        if (!response.ok) { //anything but 200 OK
            throw new Error(result.detail || "Login failed");
        }
        localStorage.setItem("student-hub-token", result.token);
        console.log(`Result ${result}`);
        window.location.replace("index.html"); //if login was successful, go to homepage
    } catch (error) {
        console.error("Error logging in:", error);
    }
});
