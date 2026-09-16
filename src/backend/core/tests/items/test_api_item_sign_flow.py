"""
Tests for the PDF electronic signature end-to-end workflow in Drive.
Covers self-signing, multi-user sign requests, recipient signing, and declining.
"""

import io
from pypdf import PdfReader, PdfWriter
import pytest
from django.core.files.storage import default_storage
from rest_framework.test import APIClient

from core import factories, models

pytestmark = pytest.mark.django_db


def create_sample_pdf_bytes():
    """Generate a minimal valid 1-page PDF."""
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def test_self_sign_flow():
    """Option C: Owner self-signs a document, producing an immediately signed stamped copy."""
    user = factories.UserFactory(full_name="Alice Durand", short_name="Alice")
    pdf_bytes = create_sample_pdf_bytes()
    item = factories.ItemFactory(
        creator=user,
        users=[(user, models.RoleChoices.OWNER)],
        title="contract.pdf",
        filename="contract.pdf",
        mimetype="application/pdf",
        type=models.ItemTypeChoices.FILE,
        upload_state=models.ItemUploadStateChoices.READY,
    )
    default_storage.save(item.file_key, io.BytesIO(pdf_bytes))

    client = APIClient()
    client.force_login(user)

    payload = {
        "signers": [user.email],
        "is_self_sign": True,
        "zone": {
            "pageIndex": 0,
            "xPct": 15.0,
            "yPct": 60.0,
            "widthPct": 30.0,
            "heightPct": 12.0,
        },
    }

    response = client.post(f"/api/v1.0/items/{item.id}/sign-requests/", payload, format="json")
    assert response.status_code == 201
    data = response.json()
    assert len(data) == 1
    assert data[0]["status"] == "signed"

    # Verify copy item was created with title "contract_alice.pdf"
    copy_item = models.Item.objects.get(id=data[0]["copy_item"])
    assert copy_item.title == "contract_alice.pdf"
    assert copy_item.upload_state == models.ItemUploadStateChoices.READY
    assert copy_item.creator == user

    # Verify SignRequest status
    sign_req = models.SignRequest.objects.get(copy_item=copy_item)
    assert sign_req.status == models.SignRequestStatusChoices.SIGNED
    assert sign_req.signer == user
    assert sign_req.issuer == user

    # Verify S3 file was stamped
    with default_storage.open(copy_item.file_key, "rb") as fd:
        stamped_content = fd.read()
    assert len(stamped_content) > len(pdf_bytes)
    reader = PdfReader(io.BytesIO(stamped_content))
    assert len(reader.pages) == 1

    # Original file is completely untouched
    assert item.title == "contract.pdf"
    assert models.SignRequest.objects.filter(copy_item=item).count() == 0


def test_request_sign_flow_multiple_signers():
    """Option D: Owner requests signatures from Bob and Charlie."""
    alice = factories.UserFactory(full_name="Alice Durand", short_name="Alice")
    bob = factories.UserFactory(email="bob@example.com", full_name="Bob Martin", short_name="Bob")
    charlie = factories.UserFactory(email="charlie@example.com", full_name="Charlie Roy", short_name="Charlie")

    pdf_bytes = create_sample_pdf_bytes()
    item = factories.ItemFactory(
        creator=alice,
        users=[(alice, models.RoleChoices.OWNER)],
        title="contrat_partenariat.pdf",
        filename="contrat_partenariat.pdf",
        mimetype="application/pdf",
        type=models.ItemTypeChoices.FILE,
        upload_state=models.ItemUploadStateChoices.READY,
    )
    default_storage.save(item.file_key, io.BytesIO(pdf_bytes))

    client = APIClient()
    client.force_login(alice)

    payload = {
        "signers": ["bob@example.com", "charlie@example.com"],
        "is_self_sign": False,
        "zone": {
            "pageIndex": 0,
            "xPct": 20.0,
            "yPct": 50.0,
            "widthPct": 25.0,
            "heightPct": 10.0,
        },
    }

    response = client.post(f"/api/v1.0/items/{item.id}/sign-requests/", payload, format="json")
    assert response.status_code == 201
    data = response.json()
    assert len(data) == 2

    # Both requests are in WAITING status
    assert all(r["status"] == "waiting" for r in data)

    bob_copy = models.Item.objects.get(title="contrat_partenariat_bob.pdf")
    charlie_copy = models.Item.objects.get(title="contrat_partenariat_charlie.pdf")

    # Both copies are non-editable (READER role assigned to signer)
    assert bob_copy.get_role(bob) == models.RoleChoices.READER
    assert charlie_copy.get_role(charlie) == models.RoleChoices.READER

    # Alice remains OWNER of both copies
    assert bob_copy.get_role(alice) == models.RoleChoices.OWNER
    assert charlie_copy.get_role(alice) == models.RoleChoices.OWNER


def test_execute_sign_success_and_permissions():
    """Case B: Bob executes signing on his copy; other users are forbidden."""
    alice = factories.UserFactory(full_name="Alice Durand", short_name="Alice")
    bob = factories.UserFactory(email="bob@example.com", full_name="Bob Martin", short_name="Bob")
    charlie = factories.UserFactory(email="charlie@example.com", full_name="Charlie Roy", short_name="Charlie")

    pdf_bytes = create_sample_pdf_bytes()
    item = factories.ItemFactory(
        creator=alice,
        users=[(alice, models.RoleChoices.OWNER)],
        title="accord.pdf",
        filename="accord.pdf",
        mimetype="application/pdf",
        type=models.ItemTypeChoices.FILE,
        upload_state=models.ItemUploadStateChoices.READY,
    )
    default_storage.save(item.file_key, io.BytesIO(pdf_bytes))

    # Alice creates sign request for Bob
    client = APIClient()
    client.force_login(alice)
    res = client.post(
        f"/api/v1.0/items/{item.id}/sign-requests/",
        {
            "signers": ["bob@example.com"],
            "zone": {"pageIndex": 0, "xPct": 10.0, "yPct": 20.0, "widthPct": 30.0, "heightPct": 15.0},
        },
        format="json",
    )
    assert res.status_code == 201
    bob_copy_id = res.json()[0]["copy_item"]

    # Charlie attempts to sign Bob's copy -> 403 Forbidden
    client.force_login(charlie)
    res_charlie = client.post(f"/api/v1.0/items/{bob_copy_id}/execute-sign/")
    assert res_charlie.status_code == 403

    # Bob signs his copy -> 200 OK
    client.force_login(bob)
    res_bob = client.post(f"/api/v1.0/items/{bob_copy_id}/execute-sign/")
    assert res_bob.status_code == 200
    assert res_bob.json()["status"] == "signed"

    # Verify status changed in DB
    sign_req = models.SignRequest.objects.get(copy_item_id=bob_copy_id)
    assert sign_req.status == models.SignRequestStatusChoices.SIGNED

    # Bob attempts to sign again -> 400 Bad Request
    res_again = client.post(f"/api/v1.0/items/{bob_copy_id}/execute-sign/")
    assert res_again.status_code == 400


def test_decline_sign_flow():
    """Case B: Bob declines to sign his copy."""
    alice = factories.UserFactory(full_name="Alice Durand", short_name="Alice")
    bob = factories.UserFactory(email="bob@example.com", full_name="Bob Martin", short_name="Bob")

    pdf_bytes = create_sample_pdf_bytes()
    item = factories.ItemFactory(
        creator=alice,
        users=[(alice, models.RoleChoices.OWNER)],
        title="bail.pdf",
        filename="bail.pdf",
        mimetype="application/pdf",
        type=models.ItemTypeChoices.FILE,
        upload_state=models.ItemUploadStateChoices.READY,
    )
    default_storage.save(item.file_key, io.BytesIO(pdf_bytes))

    client = APIClient()
    client.force_login(alice)
    res = client.post(
        f"/api/v1.0/items/{item.id}/sign-requests/",
        {
            "signers": ["bob@example.com"],
            "zone": {"pageIndex": 0, "xPct": 10.0, "yPct": 20.0, "widthPct": 30.0, "heightPct": 15.0},
        },
        format="json",
    )
    assert res.status_code == 201
    bob_copy_id = res.json()[0]["copy_item"]

    # Bob declines
    client.force_login(bob)
    res_decline = client.post(
        f"/api/v1.0/items/{bob_copy_id}/decline-sign/",
        {"reason": "Conditions non acceptables."},
        format="json",
    )
    assert res_decline.status_code == 200
    assert res_decline.json()["status"] == "declined"

    # Verify status in DB
    sign_req = models.SignRequest.objects.get(copy_item_id=bob_copy_id)
    assert sign_req.status == models.SignRequestStatusChoices.DECLINED

    # Verify declined document cannot be signed anymore
    bob_copy = models.Item.objects.get(id=bob_copy_id)
    assert bob_copy.get_abilities(bob)["can_sign"] is False
    assert bob_copy.get_abilities(alice)["can_sign"] is False

    # Attempting to execute-sign or create sign-requests on declined copy fails
    res_fail = client.post(f"/api/v1.0/items/{bob_copy_id}/execute-sign/")
    assert res_fail.status_code == 403


def test_signed_document_can_be_sent_for_further_signature():
    """When a document is approved/signed, it can still be signed or sent to someone else."""
    alice = factories.UserFactory(full_name="Alice Durand", short_name="Alice")
    bob = factories.UserFactory(email="bob@example.com", full_name="Bob Martin", short_name="Bob")
    charlie = factories.UserFactory(email="charlie@example.com", full_name="Charlie Roy", short_name="Charlie")

    pdf_bytes = create_sample_pdf_bytes()
    item = factories.ItemFactory(
        creator=alice,
        users=[(alice, models.RoleChoices.OWNER)],
        title="contrat_vente.pdf",
        filename="contrat_vente.pdf",
        mimetype="application/pdf",
        type=models.ItemTypeChoices.FILE,
        upload_state=models.ItemUploadStateChoices.READY,
    )
    default_storage.save(item.file_key, io.BytesIO(pdf_bytes))

    client = APIClient()
    client.force_login(alice)
    res = client.post(
        f"/api/v1.0/items/{item.id}/sign-requests/",
        {
            "signers": ["bob@example.com"],
            "zone": {"pageIndex": 0, "xPct": 10.0, "yPct": 20.0, "widthPct": 30.0, "heightPct": 15.0},
        },
        format="json",
    )
    bob_copy_id = res.json()[0]["copy_item"]

    # Bob signs
    client.force_login(bob)
    res_sign = client.post(f"/api/v1.0/items/{bob_copy_id}/execute-sign/")
    assert res_sign.status_code == 200

    bob_signed_item = models.Item.objects.get(id=bob_copy_id)

    # Both Bob and Alice have can_sign = True on the approved/signed document
    assert bob_signed_item.get_abilities(bob)["can_sign"] is True
    assert bob_signed_item.get_abilities(alice)["can_sign"] is True

    # Alice sends the already signed copy to Charlie for a second signature
    client.force_login(alice)
    res_chain = client.post(
        f"/api/v1.0/items/{bob_copy_id}/sign-requests/",
        {
            "signers": ["charlie@example.com"],
            "zone": {"pageIndex": 0, "xPct": 10.0, "yPct": 60.0, "widthPct": 30.0, "heightPct": 15.0},
        },
        format="json",
    )
    assert res_chain.status_code == 201
    charlie_copy_id = res_chain.json()[0]["copy_item"]

    # Charlie signs his copy
    client.force_login(charlie)
    res_charlie_sign = client.post(f"/api/v1.0/items/{charlie_copy_id}/execute-sign/")
    assert res_charlie_sign.status_code == 200
    assert res_charlie_sign.json()["status"] == "signed"


def test_sign_copy_is_non_editable():
    """Sign copies cannot be edited or modified via PATCH."""
    alice = factories.UserFactory(full_name="Alice Durand")
    bob = factories.UserFactory(email="bob@example.com")

    pdf_bytes = create_sample_pdf_bytes()
    item = factories.ItemFactory(
        creator=alice,
        users=[(alice, models.RoleChoices.OWNER)],
        title="nda.pdf",
        filename="nda.pdf",
        mimetype="application/pdf",
        type=models.ItemTypeChoices.FILE,
        upload_state=models.ItemUploadStateChoices.READY,
    )
    default_storage.save(item.file_key, io.BytesIO(pdf_bytes))

    client = APIClient()
    client.force_login(alice)
    res = client.post(
        f"/api/v1.0/items/{item.id}/sign-requests/",
        {
            "signers": ["bob@example.com"],
            "zone": {"pageIndex": 0, "xPct": 10.0, "yPct": 20.0, "widthPct": 30.0, "heightPct": 15.0},
        },
        format="json",
    )
    bob_copy_id = res.json()[0]["copy_item"]
    bob_copy = models.Item.objects.get(id=bob_copy_id)

    # Neither Alice nor Bob can edit/update the copy (it is a non-editable copy)
    assert bob_copy.get_abilities(alice)["update"] is False
    assert bob_copy.get_abilities(bob)["update"] is False

    # Attempting to rename/modify via PATCH
    client.force_login(bob)
    res_patch = client.patch(f"/api/v1.0/items/{bob_copy_id}/", {"title": "new_title.pdf"}, format="json")
    assert res_patch.status_code == 403
