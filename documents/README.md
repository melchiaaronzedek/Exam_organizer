# documents/

Local-only staging area for application forms and hall tickets. Everything in this
folder except this README is git-ignored, so nothing personal is ever pushed to the
public repository.

Suggested layout (this is also what the website's **Import zip** understands):

```
documents/
  ssc-cgl-2026/
    hall-ticket__SSC_CGL_Tier1_admit_card.pdf
    application__SSC_CGL_application.pdf
  uiic-ao-2026/
    application__UIIC_AO_application.pdf
```

`<examId>/<type>__<filename>` where type is one of: application, hall-ticket,
notification, receipt, photo, result, other. Zip the folder and import it on the
Documents page; files are stored in your browser only.
