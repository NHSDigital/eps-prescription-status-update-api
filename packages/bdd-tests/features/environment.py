"""Behave environment setup and teardown."""
import requests
from urllib3.exceptions import InsecureRequestWarning

# Suppress only the single InsecureRequestWarning from urllib3
requests.packages.urllib3.disable_warnings(category=InsecureRequestWarning)


def before_all(context):
    """Set up test environment before all tests."""
    context.base_url = "http://0.0.0.0:3000"
    context.timeout = 10


def before_scenario(context, scenario):
    """Set up before each scenario."""
    context.response = None


def after_scenario(context, scenario):
    """Clean up after each scenario."""
    pass
