import click
import json
import uuid
import jwt
import requests
from time import time
from datetime import datetime
from rich.console import Console
from rich.theme import Theme
from rich.prompt import Confirm, Prompt


cli_theme = Theme(
    {
        "heading": "bold italic underline",
        "key": "bold italic",
        "value": "dim",
        "info": "deep_sky_blue4",
        "error": "red1",
        "success": "green4",
        "config": "purple4",
        "data": "orange3",
    }
)
console = Console(theme=cli_theme, highlight=False)


def log_heading(heading, style):
    console.print(f"[heading]{heading}[/heading]", style=style)


def log_key_value(key, value, style):
    console.print(f"[key]{key}:[/key] [value]{value}[/value]", style=style)


@click.group()
def cli():
    pass


@cli.command()
@click.option(
    "-d",
    "--creds_dir",
    default="/home/vscode/.ssh",
    help="The directory containing any key pairs & psu-creds.json, defaults to '/home/vscode/.ssh'",
)
def update_creds(creds_dir):
    try:
        with open(f"{creds_dir}/psu_creds.json", "r") as f:
            psu_creds = json.load(f)
    except FileNotFoundError:
        console.print(
            f"PSU creds file does not exist, will create file at [bold]{creds_dir}/psu_creds.json[/bold]",
            style="info",
        )
        psu_creds = {}

    add_keys = True
    while add_keys:
        console.print("Please enter the credential details:", style="info")
        env = Prompt.ask("[bold italic purple4]Environment")
        key = Prompt.ask("[bold italic purple4]API key")

        if env in psu_creds:
            is_correct = Confirm.ask(
                f"[deep_sky_blue4]Credentials for {env} already exist, do you want to overwrite them?"
            )
        else:
            is_correct = Confirm.ask("[deep_sky_blue4]Is this correct?")

        if is_correct:
            psu_creds[env] = key

        add_keys = Confirm.ask(
            "[deep_sky_blue4]Do you want to continue adding credentials?"
        )
        console.print("--------------------------------------------", style="info")

    with open(f"{creds_dir}/psu_creds.json", "w+") as f:
        json.dump(psu_creds, f)
    console.print("Credentials updated!", style="success")


@cli.command()
@click.option(
    "-d",
    "--creds_dir",
    default="/home/vscode/.ssh",
    help="The directory containing any key pairs & psu-creds.json, defaults to '/home/vscode/.ssh'",
)
def list_creds(creds_dir):
    console.print(
        f"Getting PSU credentials file at [bold]{creds_dir}/psu_creds.json[/bold]...",
        style="info",
    )
    try:
        with open(f"{creds_dir}/psu_creds.json", "r") as f:
            psu_creds = json.load(f)
    except FileNotFoundError:
        log_key_value("Error", "PSU credentials file not found.", "error")
        console.print_exception()
        exit()
    console.print("--------------------------------------------", style="config")
    log_heading("PSU Credentials:", "config")
    for key, value in psu_creds.items():
        log_key_value(key, value, "config")
    console.print("--------------------------------------------", style="config")
    console.print("Complete!", style="success")


@cli.command()
@click.option(
    "-k",
    "--api_key",
    default=None,
    help="The api key, defaults to the value of <env> in psu-creds.json",
)
@click.option(
    "-d",
    "--creds_dir",
    default="/home/vscode/.ssh",
    help="The directory containing any key pairs & psu-creds.json, defaults to '/home/vscode/.ssh'",
)
@click.option(
    "-e",
    "--env",
    default="internal-dev",
    help="The target environment, defaults to 'internal-dev'",
)
@click.option(
    "-x",
    "--expiry",
    default=300,
    help="The JWT expiry in seconds, defaults to 300(5mins)",
)
@click.option(
    "-i", "--kid", default=None, help="The kid of the key pair, defaults to 'psu-<env>'"
)
def encode_jwt(api_key, creds_dir, env, expiry, kid, standalone=True):
    kid = kid if kid else f"psu-{env}"

    if not api_key:
        console.print(
            f"Getting API key for [bold]{env}[/bold] from psu_creds.json...",
            style="info",
        )
        try:
            with open(f"{creds_dir}/psu_creds.json", "r") as f:
                psu_creds = json.load(f)
        except FileNotFoundError:
            log_key_value("Error", "PSU credentials file not found.", "error")
            console.print_exception()
            exit()

        env_key = psu_creds.get(env)
        if not env_key:
            log_key_value("Error", f"Key not found for env: {env}", "error")
            exit()
        api_key = env_key

    console.print("--------------------------------------------", style="config")
    log_heading("Config:", "config")
    log_key_value("Env", env, "config")
    log_key_value("Credentials dir", creds_dir, "config")
    log_key_value("KID", kid, "config")
    log_key_value("API key", api_key, "config")
    log_key_value("Expiry", expiry, "config")
    console.print("--------------------------------------------", style="config")

    is_config_ok = Confirm.ask("[purple4]Is this correct?")
    if not is_config_ok:
        exit()
    console.print("--------------------------------------------", style="config")

    console.print(
        f"Getting private key from [bold]{creds_dir}/{kid}.pem[/bold]...", style="info"
    )
    try:
        with open(f"{creds_dir}/{kid}.pem", "r") as f:
            private_key = f.read()
    except FileNotFoundError:
        log_key_value("Error", "Private key not found.", "error")
        console.print_exception()
        exit()

    claims = {
        "sub": api_key,
        "iss": api_key,
        "jti": str(uuid.uuid4()),
        "aud": f"https://{env}.api.service.nhs.uk/oauth2/token",
        "exp": int(time()) + expiry,
    }
    additional_headers = {"kid": kid}

    console.print("Encoding JWT...", style="info")
    encoded_jwt = jwt.encode(
        claims, private_key, algorithm="RS512", headers=additional_headers
    )

    console.print("Encoding complete!", style="success")
    if standalone:
        console.print("--------------------------------------------", style="data")
        console.print(encoded_jwt, style="data", soft_wrap=True)
        console.print("--------------------------------------------", style="data")
    return encoded_jwt


@cli.command()
@click.option(
    "-t",
    "--encoded_jwt",
    help="The encoded JWT to exchange with the authorisation server",
    prompt=True,
)
@click.option(
    "-e",
    "--env",
    default="internal-dev",
    help="The target environment, defaults to 'internal-dev'",
)
def exchange_tokens(encoded_jwt, env):
    console.print(
        f"Exchanging tokens with [bold]https://{env}.api.service.nhs.uk/oauth2/token[/bold]...",
        style="info",
    )
    data = {
        "grant_type": "client_credentials",
        "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        "client_assertion": encoded_jwt,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    res = requests.post(
        f"https://{env}.api.service.nhs.uk/oauth2/token", data=data, headers=headers
    )
    status_code = res.status_code
    body = json.loads(res.text)

    if status_code != 200:
        log_key_value("Error", "Failed to exchange tokens.", "error")
        console.print("--------------------------------------------", style="error")
        log_key_value("Status Code", status_code, "error")
        for key, value in body.items():
            log_key_value(key, value, "error")
        console.print("--------------------------------------------", style="error")
        exit()

    access_token = body.get("access_token")
    expires_timestamp = int(body.get("issued_at")) / 1000 + int(body.get("expires_in"))
    expires_iso = datetime.fromtimestamp(expires_timestamp).astimezone().isoformat()

    console.print("Exchange successful!", style="success")
    console.print("--------------------------------------------", style="data")
    log_key_value("Access token", access_token, "data")
    log_key_value("Expires", expires_iso, "data")
    console.print("--------------------------------------------", style="data")


@cli.command()
@click.option(
    "-k",
    "--api_key",
    default=None,
    help="The api key, defaults to the value of <env> in psu-creds.json",
)
@click.option(
    "-d",
    "--creds_dir",
    default="/home/vscode/.ssh",
    help="The directory containing any key pairs & psu-creds.json, defaults to '/home/vscode/.ssh'",
)
@click.option(
    "-e",
    "--env",
    default="internal-dev",
    help="The target environment, defaults to 'internal-dev'",
)
@click.option(
    "-x",
    "--expiry",
    default=300,
    help="The JWT expiry in seconds, defaults to 300(5mins)",
)
@click.option(
    "-i", "--kid", default=None, help="The KID of the key pair, defaults to 'psu-<env>'"
)
@click.pass_context
def auth(ctx, api_key, creds_dir, env, expiry, kid):
    console.print("Authenticating...", style="info")
    encoded_jwt = ctx.forward(encode_jwt, standalone=False)
    ctx.invoke(exchange_tokens, encoded_jwt=encoded_jwt, env=env)
    console.print("Authentication complete!", style="success")


if __name__ == "__main__":
    cli()
