#!/usr/bin/env python3
"""Build and export stateful SAM/CDK templates into ./tmp as sorted JSON."""

from __future__ import annotations

import copy
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent
TMP_DIR = REPO_ROOT / "tmp"
SAM_TEMPLATE = REPO_ROOT / "SAMtemplates" / "stateful_template.yaml"
SAM_BUILD_TEMPLATE = REPO_ROOT / ".aws-sam" / "build" / "template.yaml"
CDK_TEMPLATE = REPO_ROOT / "cdk.out" / "PsuApiStatefulStack.template.json"
TMP_SAM_JSON = TMP_DIR / "stateful_sam.template.json"
TMP_CDK_JSON = TMP_DIR / "PsuApiStatefulStack.template.json"
SUB_TOKEN_PATTERN = re.compile(r"\$\{([^}]+)\}")
CDK_LOGICAL_ID_SUFFIX_PATTERN = re.compile(r'^(?P<base>.+?)(?P<suffix>[A-F0-9]{8})$')
SAM_NESTED_TABLE_POLICY_PATTERN = re.compile(
    r'^(?P<prefix>.+)ResourcesTable(?P<access>Read|Write)ManagedPolicy$'
)
RESOURCE_NAME_ALIASES = {
    'TablesPrescriptionNotificationStatesTableReadPolicy': (
        'TablesPrescriptionNotificationStatesV1TableReadPolicy'
    ),
    'TablesPrescriptionNotificationStatesTableWritePolicy': (
        'TablesPrescriptionNotificationStatesV1TableWritePolicy'
    ),
    'TablesPrescriptionNotificationStatesTableV1NotifyMessageIDIndex': (
        'TablesNotifyMessageIDIndex'
    ),
    'TablesPrescriptionNotificationStatesTableV1PatientPharmacyIndex': (
        'TablesPatientPharmacyIndex'
    ),
    'TablesPrescriptionStatusUpdatesTablePharmacyODSCodePrescriptionIDIndex': (
        'TablesPharmacyIndex'
    ),
    'TablesPrescriptionStatusUpdatesTablePatientNHSNumberIndex': (
        'TablesNHSNumberIndex'
    )
}
SAM_SCALING_NAME_PATTERN = re.compile(
    r'^(?P<prefix>.+)Scaling(?P<access>Read|Write)(?P<kind>Policy|Target)$'
)
EXCLUDED_CANONICAL_RESOURCE_NAMES = {
    'CDKMetadata',
    # These QueuePolicy resources are intentionally CDK-only.
    # They enforce deny-on-insecure-transport (aws:SecureTransport=false),
    # which is stronger in-transit assurance than the current SAM baseline.
    'MessagingNHSNotifyPrescriptionsDeadLetterQueuePolicy',
    'MessagingNHSNotifyPrescriptionsSQSQueuePolicy',
    'MessagingPostDatedNotificationsDeadLetterQueuePolicy',
    'MessagingPostDatedNotificationsSQSQueuePolicy'
}
REF_KEY = 'Ref'
GETATT_KEY = 'Fn::GetAtt'
SUB_KEY = 'Fn::Sub'
IF_KEY = 'Fn::If'
EQUALS_KEY = 'Fn::Equals'


@dataclass
class TemplateContext:
    prefix: str
    parameter_bindings: dict[str, Any]
    parameter_defaults: dict[str, Any]
    passthrough_parameter_names: set[str]
    local_resource_names: set[str]
    nested_application_names: set[str]
    local_condition_names: set[str]
    nested_output_values: dict[str, dict[str, Any]]


@dataclass
class ExpandedTemplate:
    resources: dict[str, Any]
    outputs: dict[str, Any]
    output_values: dict[str, Any]
    conditions: dict[str, Any]


def prefixed_name(prefix: str, name: str) -> str:
    return f"{prefix}{name}" if prefix else name


def deep_copy(value: Any) -> Any:
    return copy.deepcopy(value)


def run_command(command: list[str], env: dict[str, str] | None = None) -> None:
    subprocess.run(command, cwd=REPO_ROOT, check=True, env=env)


def write_sorted_json(source_data: object, destination: Path) -> None:
    destination.write_text(json.dumps(source_data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load_yaml_template(template_path: Path) -> dict[str, Any]:
    with template_path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def build_stateful_sam() -> None:
    run_command([
        "sam",
        "build",
        "--template-file",
        str(SAM_TEMPLATE.relative_to(REPO_ROOT)),
        "--region",
        "eu-west-2"
    ])


def synthesize_stateful_cdk() -> None:
    env = dict(os.environ)
    env.update({
        "CDK_APP_NAME": "PsuApiApp",
        "CDK_CONFIG_stackMode": "stateful",
        "CDK_CONFIG_stackName": "psu-cdk-stateful",
        "CDK_CONFIG_versionNumber": "undefined",
        "CDK_CONFIG_commitId": "undefined",
        "CDK_CONFIG_isPullRequest": "true",
        "CDK_CONFIG_logRetentionInDays": "30",
        "CDK_CONFIG_environment": "dev",
        "CDK_CONFIG_enableDynamoDBAutoScaling": "true",
        "CDK_CONFIG_enableBackup": "false"
    })
    run_command(["npm", "run", "cdk-synth", "--workspace", "packages/cdk"], env=env)


def rewrite_condition_name(condition_name: str, context: TemplateContext) -> str:
    if condition_name in context.local_condition_names:
        return prefixed_name(context.prefix, condition_name)
    return condition_name


def rewrite_ref(reference_name: str, context: TemplateContext) -> Any:
    if reference_name in context.passthrough_parameter_names:
        return {REF_KEY: reference_name}

    if reference_name in context.parameter_bindings:
        return deep_copy(context.parameter_bindings[reference_name])

    if reference_name in context.parameter_defaults:
        return deep_copy(context.parameter_defaults[reference_name])

    if reference_name in context.local_resource_names and reference_name not in context.nested_application_names:
        return {REF_KEY: prefixed_name(context.prefix, reference_name)}

    return {REF_KEY: reference_name}


def parse_getatt(getatt_value: Any) -> tuple[str, str] | None:
    if isinstance(getatt_value, list) and len(getatt_value) == 2:
        return str(getatt_value[0]), str(getatt_value[1])

    if isinstance(getatt_value, str) and "." in getatt_value:
        target, attribute = getatt_value.split(".", 1)
        return target, attribute

    return None


def rewrite_getatt(getatt_value: Any, context: TemplateContext) -> Any:
    parsed_getatt = parse_getatt(getatt_value)
    if not parsed_getatt:
        return {GETATT_KEY: getatt_value}

    target_name, attribute_name = parsed_getatt

    if target_name in context.nested_output_values and attribute_name.startswith("Outputs."):
        output_name = attribute_name.split(".", 1)[1]
        if output_name in context.nested_output_values[target_name]:
            return deep_copy(context.nested_output_values[target_name][output_name])

    if target_name in context.local_resource_names and target_name not in context.nested_application_names:
        return {GETATT_KEY: [prefixed_name(context.prefix, target_name), attribute_name]}

    return {GETATT_KEY: getatt_value}


def rewrite_resource_sub_phrase(
    phrase: str,
    template_string: str,
    context: TemplateContext
) -> tuple[str, dict[str, Any] | None]:
    if "." in phrase:
        target_name, attribute_name = phrase.split(".", 1)
        if target_name in context.local_resource_names and target_name not in context.nested_application_names:
            return (
                template_string.replace(
                    f"${{{phrase}}}",
                    f"${{{prefixed_name(context.prefix, target_name)}.{attribute_name}}}"
                ),
                None
            )

        if target_name in context.nested_output_values and attribute_name.startswith("Outputs."):
            output_name = attribute_name.split(".", 1)[1]
            if output_name in context.nested_output_values[target_name]:
                return template_string, deep_copy(context.nested_output_values[target_name][output_name])

    if phrase in context.local_resource_names and phrase not in context.nested_application_names:
        return template_string.replace(
            f"${{{phrase}}}",
            f"${{{prefixed_name(context.prefix, phrase)}}}"
        ), None

    return template_string, None


def rewrite_parameter_sub_phrase(phrase: str, context: TemplateContext) -> Any | None:
    if phrase in context.parameter_bindings:
        return deep_copy(context.parameter_bindings[phrase])

    if phrase in context.parameter_defaults:
        return deep_copy(context.parameter_defaults[phrase])

    return None


def rewrite_substitution(substitution_value: Any, context: TemplateContext) -> Any:
    if isinstance(substitution_value, str):
        template_string = substitution_value
        variables: dict[str, Any] = {}
        original_used_map = False
    else:
        template_string = substitution_value[0]
        variables = {key: rewrite_node(value, context) for key, value in substitution_value[1].items()}
        original_used_map = True

    for token in SUB_TOKEN_PATTERN.findall(template_string):
        if token in variables:
            continue

        template_string, resource_value = rewrite_resource_sub_phrase(token, template_string, context)
        if resource_value is not None:
            variables[token] = resource_value
            continue

        parameter_value = rewrite_parameter_sub_phrase(token, context)
        if parameter_value is not None:
            variables[token] = parameter_value

    if variables or original_used_map:
        return {SUB_KEY: [template_string, variables]}

    return {SUB_KEY: template_string}


def rewrite_node(node: Any, context: TemplateContext) -> Any:
    if isinstance(node, list):
        return [rewrite_node(item, context) for item in node]

    if not isinstance(node, dict):
        return node

    if set(node.keys()) == {REF_KEY}:
        return rewrite_ref(node[REF_KEY], context)

    if set(node.keys()) == {GETATT_KEY}:
        return rewrite_getatt(node[GETATT_KEY], context)

    if set(node.keys()) == {SUB_KEY}:
        return rewrite_substitution(node[SUB_KEY], context)

    if set(node.keys()) == {IF_KEY}:
        condition_name, true_value, false_value = node[IF_KEY]
        return {
            IF_KEY: [
                rewrite_condition_name(condition_name, context),
                rewrite_node(true_value, context),
                rewrite_node(false_value, context)
            ]
        }

    if set(node.keys()) == {EQUALS_KEY}:
        return {EQUALS_KEY: rewrite_node(node[EQUALS_KEY], context)}

    rewritten_node: dict[str, Any] = {}
    for key, value in node.items():
        if key == "Condition" and isinstance(value, str):
            rewritten_node[key] = rewrite_condition_name(value, context)
        else:
            rewritten_node[key] = rewrite_node(value, context)
    return rewritten_node


def expand_built_template(
    template_path: Path,
    prefix: str = "",
    parameter_bindings: dict[str, Any] | None = None,
    passthrough_parameter_names: set[str] | None = None
) -> ExpandedTemplate:
    template = load_yaml_template(template_path)
    template_directory = template_path.parent
    resource_map = template.get("Resources", {})
    nested_application_names = {
        logical_id
        for logical_id, resource in resource_map.items()
        if resource.get("Type") == "AWS::Serverless::Application"
    }
    parameter_defaults = {
        parameter_name: parameter_definition["Default"]
        for parameter_name, parameter_definition in template.get("Parameters", {}).items()
        if isinstance(parameter_definition, dict) and "Default" in parameter_definition
    }

    base_context = TemplateContext(
        prefix=prefix,
        parameter_bindings=parameter_bindings or {},
        parameter_defaults=parameter_defaults,
        passthrough_parameter_names=passthrough_parameter_names or set(),
        local_resource_names=set(resource_map.keys()),
        nested_application_names=nested_application_names,
        local_condition_names=set(template.get("Conditions", {}).keys()),
        nested_output_values={}
    )

    expanded_resources: dict[str, Any] = {}
    expanded_outputs: dict[str, Any] = {}
    expanded_conditions: dict[str, Any] = {}
    nested_output_values: dict[str, dict[str, Any]] = {}

    for logical_id in nested_application_names:
        nested_application = resource_map[logical_id]
        nested_location = nested_application["Properties"]["Location"]
        nested_parameter_bindings = {
            name: rewrite_node(value, base_context)
            for name, value in nested_application["Properties"].get("Parameters", {}).items()
        }
        nested_template = expand_built_template(
            template_directory / nested_location,
            prefix=prefixed_name(prefix, logical_id),
            parameter_bindings=nested_parameter_bindings,
            passthrough_parameter_names=passthrough_parameter_names
        )
        expanded_resources.update(nested_template.resources)
        expanded_outputs.update(nested_template.outputs)
        expanded_conditions.update(nested_template.conditions)
        nested_output_values[logical_id] = nested_template.output_values

    rewrite_context = TemplateContext(
        prefix=prefix,
        parameter_bindings=parameter_bindings or {},
        parameter_defaults=parameter_defaults,
        passthrough_parameter_names=passthrough_parameter_names or set(),
        local_resource_names=set(resource_map.keys()),
        nested_application_names=nested_application_names,
        local_condition_names=set(template.get("Conditions", {}).keys()),
        nested_output_values=nested_output_values
    )

    for condition_name, condition_definition in template.get("Conditions", {}).items():
        expanded_conditions[prefixed_name(prefix, condition_name)] = rewrite_node(condition_definition, rewrite_context)

    for logical_id, resource_definition in resource_map.items():
        if logical_id in nested_application_names:
            continue
        expanded_resources[prefixed_name(prefix, logical_id)] = rewrite_node(resource_definition, rewrite_context)

    output_values: dict[str, Any] = {}
    for output_name, output_definition in template.get("Outputs", {}).items():
        rewritten_output = rewrite_node(output_definition, rewrite_context)
        expanded_outputs[prefixed_name(prefix, output_name)] = rewritten_output
        output_values[output_name] = rewritten_output["Value"]

    return ExpandedTemplate(
        resources=expanded_resources,
        outputs=expanded_outputs,
        output_values=output_values,
        conditions=expanded_conditions
    )


def export_sam_json() -> None:
    root_template = load_yaml_template(SAM_BUILD_TEMPLATE)
    expanded_template = expand_built_template(
        SAM_BUILD_TEMPLATE,
        passthrough_parameter_names=set(root_template.get("Parameters", {}).keys())
    )

    sam_template: dict[str, Any] = {
        "AWSTemplateFormatVersion": root_template.get("AWSTemplateFormatVersion", "2010-09-09"),
        "Description": "Flattened stateful SAM resources for comparison",
        "Parameters": root_template.get("Parameters", {}),
        "Resources": expanded_template.resources,
        "Outputs": expanded_template.outputs
    }

    if expanded_template.conditions:
        sam_template["Conditions"] = expanded_template.conditions

    write_sorted_json(sam_template, TMP_SAM_JSON)


def export_cdk_json() -> None:
    with CDK_TEMPLATE.open("r", encoding="utf-8") as handle:
        cdk_template = json.load(handle)
    write_sorted_json(cdk_template, TMP_CDK_JSON)


def canonicalize_resource_name(resource_name: str) -> str:
    matched_name = CDK_LOGICAL_ID_SUFFIX_PATTERN.match(resource_name)
    if matched_name:
        resource_name = matched_name.group('base')

    if resource_name.endswith('ScalingTargetTracking'):
        resource_name = f"{resource_name.removesuffix('ScalingTargetTracking')}ScalingPolicy"

    sam_scaling_name_match = SAM_SCALING_NAME_PATTERN.match(resource_name)
    if sam_scaling_name_match:
        resource_name = (
            f"{sam_scaling_name_match.group('prefix')}"
            f"{sam_scaling_name_match.group('access')}Scaling"
            f"{sam_scaling_name_match.group('kind')}"
        )

    nested_table_policy_match = SAM_NESTED_TABLE_POLICY_PATTERN.match(resource_name)
    if nested_table_policy_match:
        resource_name = (
            f"{nested_table_policy_match.group('prefix')}"
            f"Table{nested_table_policy_match.group('access')}Policy"
        )

    for original_prefix, canonical_prefix in RESOURCE_NAME_ALIASES.items():
        if resource_name.startswith(original_prefix):
            return resource_name.replace(original_prefix, canonical_prefix, 1)

    return resource_name


def build_canonical_name_map(resource_names: set[str]) -> dict[str, set[str]]:
    canonical_name_map: dict[str, set[str]] = {}
    for resource_name in resource_names:
        canonical_name = canonicalize_resource_name(resource_name)
        if canonical_name in EXCLUDED_CANONICAL_RESOURCE_NAMES:
            continue
        canonical_name_map.setdefault(canonical_name, set()).add(resource_name)
    return canonical_name_map


def print_resource_group(title: str, resource_names_by_canonical_name: dict[str, set[str]]) -> None:
    print(title)
    if not resource_names_by_canonical_name:
        print('  (none)')
        return

    for canonical_name in sorted(resource_names_by_canonical_name):
        actual_names = sorted(resource_names_by_canonical_name[canonical_name])
        if len(actual_names) == 1 and actual_names[0] == canonical_name:
            print(f'  - {canonical_name}')
        else:
            print(f"  - {canonical_name}: {', '.join(actual_names)}")


def assert_resource_equivalence() -> None:
    sam_template = json.loads(TMP_SAM_JSON.read_text(encoding='utf-8'))
    cdk_template = json.loads(TMP_CDK_JSON.read_text(encoding='utf-8'))

    sam_resource_names = set(sam_template.get('Resources', {}).keys())
    cdk_resource_names = set(cdk_template.get('Resources', {}).keys())

    sam_resource_names_by_canonical_name = build_canonical_name_map(sam_resource_names)
    cdk_resource_names_by_canonical_name = build_canonical_name_map(cdk_resource_names)

    only_in_cdk = {
        canonical_name: cdk_resource_names_by_canonical_name[canonical_name]
        for canonical_name in cdk_resource_names_by_canonical_name.keys() - sam_resource_names_by_canonical_name.keys()
    }
    only_in_sam = {
        canonical_name: sam_resource_names_by_canonical_name[canonical_name]
        for canonical_name in sam_resource_names_by_canonical_name.keys() - cdk_resource_names_by_canonical_name.keys()
    }

    print_resource_group('Canonical resource names present in CDK but absent from SAM:', only_in_cdk)
    print_resource_group('Canonical resource names present in SAM but absent from CDK:', only_in_sam)


def main() -> int:
    TMP_DIR.mkdir(exist_ok=True)
    build_stateful_sam()
    synthesize_stateful_cdk()
    export_sam_json()
    export_cdk_json()
    assert_resource_equivalence()
    print(f"Wrote {TMP_SAM_JSON.relative_to(REPO_ROOT)}")
    print(f"Wrote {TMP_CDK_JSON.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        print(f"Command failed with exit code {error.returncode}: {' '.join(error.cmd)}", file=sys.stderr)
        raise SystemExit(error.returncode) from error
