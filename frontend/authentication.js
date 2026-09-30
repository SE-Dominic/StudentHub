//authentication.js file

const signupForm = document.getElementById("signupForm");
const emailID = document.getElementById("email");
const passwordID = document.getElementById("password");
//listening for type submit to be sent
signupForm.addEventListener('submit', async(event) => {
    event.preventDefault(); //prevent browser from reloading the page
    
    const formData = new FormData(signupForm); //form data object
    
    const data = { //data in the form of a dictionary
        email: formData.get("email"),
        password: formData.get("password")
    }

    //send HTTP POST request using fetch
    try{
        const response = await fetch("http://127.0.0.1:8000/signup", {
            method:'POST', //method being used
            headers: {
                'Content-Type': 'application/json' //we are sending json to fastapi
            },
            body: JSON.stringify(data) //convert js object to json
        });
        const result = await response.json();
        if (!response.ok) { //response is not 200 
            throw new Error(result.detail || "Sign-up failed");
        }
        localStorage.setItem("student-hub-token", result.token);
        console.log(result);
        window.location.replace("index.html");
    } catch(error) {
        console.error("Error sending data:", error);
    }
})