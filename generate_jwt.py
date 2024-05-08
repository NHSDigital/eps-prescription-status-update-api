import click
import json
import uuid
import jwt
import requests
from time import time
from rich.console import Console
from rich.theme import Theme
from rich.prompt import Confirm


cli_theme = Theme({
    "heading": "bold italic underline purple4",
    "key": "bold italic purple4",
    "value": "dim purple4",
    "info": "deep_sky_blue4",
    "error": "red",
    "data": "orange3"
})
console = Console(theme=cli_theme, highlight=False)


@click.group()
def cli():
    pass


@cli.command()
@click.option("--api_key", default=None, help="the api key, defaults to the value of <env> in psu-creds.json")
@click.option("--creds_dir", default="/home/vscode/.ssh",
              help="the directory containing any key pairs & psu-cred.json, defaults to '/home/vscode/.ssh'")
@click.option("--env", default="internal-dev", help="the target environment, defaults to 'internal-dev'")
@click.option("--expiry", default=300, help="The JWT expiry in seconds, defaults to 300(5mins)")
@click.option("--kid", default=None, help="the kid of the key pair, defaults to 'psu-<env>'")
def encode_jwt(api_key, creds_dir, env, expiry, kid):
    kid = kid if kid else f"psu-{env}"

    if not api_key:
        console.print(f"Getting API key for [bold]{env}[/bold] from psu_creds.json...", style="info")
        try:
            with open(f"{creds_dir}/psu_creds.json", "r") as f:
                psu_creds = json.load(f)
        except FileNotFoundError:
            console.print("[bold]Error:[/bold] PSU credentials file not found.", style="error")
            console.print_exception()
            exit()

        env_key = psu_creds.get(env)
        if not env_key:
            console.print(f"[bold]Error:[/bold] Key not found for env: {env}", style="error")
            exit()
        api_key = env_key

    console.print("--------------------------------------------", style="key")
    console.print("Config:", style="heading")
    console.print(f"[key]Env:[/key] [value]{env}[/value]")
    console.print(f"[key]Credentials dir:[/key] [value]{creds_dir}[/value]")
    console.print(f"[key]KID:[/key] [value]{kid}[/value]")
    console.print(f"[key]API Key:[/key] [value]{api_key}[/value]")
    console.print(f"[key]Expiry:[/key] [value]{expiry}[/value]")
    console.print("--------------------------------------------", style="key")

    is_config_ok = Confirm.ask("Is this correct?")
    if not is_config_ok:
        exit()
    console.print("--------------------------------------------", style="key")

    console.print(f"Getting private key from [bold]{creds_dir}/{kid}.pem[/bold]...", style="info")
    try:
        with open(f"{creds_dir}/{kid}.pem", "r") as f:
            private_key = f.read()
    except FileNotFoundError:
        console.print("[bold]Error:[/bold] Private key not found.", style="error")
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
    console.print(encoded_jwt, style="data")
    console.print("Complete!", style="info")
    return encoded_jwt


@cli.command()
@click.option("--encoded_jwt", help="the jwt")
@click.option("--env", default="internal-dev", help="the target environment, defaults to 'internal-dev'")
def exchange_tokens(encoded_jwt, env):
    print(encoded_jwt)
    print(env)
    data = {
        "grant_type": "client_credentials",
        "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        "client_assertion": encoded_jwt
    }
    headers = {
        "Content-Type": "application/x-www-form-urlencoded"
    }

    res = requests.post(f"https://{env}.api.service.nhs.uk/oauth2/token", data=data, headers=headers)
    console.print(res.text, style="data")


@cli.command()
@click.option("--api_key", default=None, help="the api key, defaults to the value of <env> in psu-creds.json")
@click.option("--creds_dir", default="/home/vscode/.ssh",
              help="the directory containing any key pairs & psu-cred.json, defaults to '/home/vscode/.ssh'")
@click.option("--env", default="internal-dev", help="the target environment, defaults to 'internal-dev'")
@click.option("--expiry", default=300, help="The JWT expiry in seconds, defaults to 300(5mins)")
@click.option("--kid", default=None, help="the kid of the key pair, defaults to 'psu-<env>'")
@click.pass_context
def auth(ctx, api_key, creds_dir, env, expiry, kid):
    encoded_jwt = ctx.forward(encode_jwt)
    ctx.invoke(exchange_tokens, encoded_jwt=encoded_jwt, env=env)


if __name__ == "__main__":
    cli()
